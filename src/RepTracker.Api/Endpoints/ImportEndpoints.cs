using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;
using RepTracker.Api.Import;

namespace RepTracker.Api.Endpoints;

public static class ImportEndpoints
{
    /// <summary>
    /// The one endpoint allowed past the 64 KB body cap: years of sets is a few hundred kilobytes.
    /// Raised per request, so every other endpoint keeps the tight limit.
    /// </summary>
    public const long MaxBytes = 2 * 1024 * 1024;

    public static void MapImport(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/import").RequireAuthorization();

        group.MapPost("/workouts", Workouts).RequireRateLimiting(RateLimits.Import);
    }

    /// <summary>
    /// Reads a CSV of sets from the raw request body. Without <paramref name="commit"/> it only reports
    /// what it would do, so the client can show a preview; with it, it writes everything in one
    /// transaction, or nothing if the file has any error in it.
    /// </summary>
    private static async Task<IResult> Workouts(
        HttpContext ctx, AppDb db, AppOptions options, CancellationToken ct,
        bool commit = false, string? timeZone = null, int? offsetMinutes = null)
    {
        var sizeLimit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (sizeLimit is { IsReadOnly: false }) sizeLimit.MaxRequestBodySize = MaxBytes;

        string text;
        try
        {
            using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            text = await reader.ReadToEndAsync(ct);
        }
        catch (BadHttpRequestException) when (ctx.Request.ContentLength is null or > MaxBytes)
        {
            return Results.Problem(detail: "The file is larger than 2 MB. Split it and import the parts.", statusCode: 413);
        }

        var user = ctx.CurrentUser();
        var now = DateTimeOffset.UtcNow;
        var zone = Zone(timeZone, offsetMinutes);
        var parsed = WorkoutCsv.Parse(text, user.Units, zone, now, options.Limits);
        var errors = parsed.Errors.Select(e => new ImportErrorDto(e.Line, e.Message)).ToList();

        // ---- workouts already here are skipped, so importing the same file twice is harmless ----

        var fresh = parsed.Workouts;
        if (fresh.Count > 0)
        {
            var from = fresh.Min(w => w.StartedAt).ToUniversalTime();
            var to = fresh.Max(w => w.StartedAt).ToUniversalTime();
            var existing = (await db.Workouts
                    .Where(w => w.UserId == user.Id && w.StartedAt >= from && w.StartedAt <= to)
                    .Select(w => new { w.StartedAt, w.Name })
                    .ToListAsync(ct))
                .Select(w => (w.StartedAt.UtcTicks, w.Name.ToLowerInvariant()))
                .ToHashSet();

            fresh = [.. parsed.Workouts.Where(w => !existing.Contains((w.StartedAt.UtcTicks, w.Name.ToLowerInvariant())))];
        }
        var duplicates = parsed.Workouts.Count - fresh.Count;

        var total = await db.Workouts.CountAsync(w => w.UserId == user.Id, ct);
        if (total + fresh.Count > options.Limits.Workouts)
            errors.Add(new(0, $"Importing {fresh.Count} workouts would pass the limit of {options.Limits.Workouts} per account."));

        // ---- exercises: the catalogue and the user's own; anything unmatched is created ----

        var visible = await db.Exercises.Where(e => e.UserId == null || e.UserId == user.Id).ToListAsync(ct);

        // Matching ignores spacing, hyphens and case. A user's own exercise wins over a catalogue one
        // that reduces to the same letters.
        var byLooseKey = visible
            .GroupBy(e => WorkoutCsv.LooseKey(e.Name))
            .ToDictionary(g => g.Key, g => g.OrderBy(e => e.UserId == null ? 1 : 0).First());

        // Each spelling in the file resolved once. A new exercise joins the lookup as soon as it is
        // made, so "Sled-Push" further down lands on the "Sled Push" created above it.
        var resolved = new Dictionary<string, Exercise>(StringComparer.OrdinalIgnoreCase);
        var created = new List<Exercise>();
        var matched = new HashSet<Guid>();
        var renamed = new List<ImportRenamedDto>();

        foreach (var name in fresh.SelectMany(w => w.Exercises).Select(e => e.Name))
        {
            if (resolved.ContainsKey(name)) continue;

            var exercise = WorkoutCsv.Match(name, byLooseKey);
            if (exercise is null)
            {
                var hints = parsed.Hints[name.ToLowerInvariant()];
                exercise = new Exercise
                {
                    Id = Guid.CreateVersion7(),
                    UserId = user.Id,
                    Name = name,
                    NameNormalized = name.ToLowerInvariant(),
                    MuscleGroup = hints.MuscleGroup ?? "Other",
                    Modality = WorkoutCsv.InferModality(hints),
                    CreatedAt = now,
                };
                created.Add(exercise);
                byLooseKey[WorkoutCsv.LooseKey(name)] = exercise;
            }
            else
            {
                if (created.All(c => c.Id != exercise.Id)) matched.Add(exercise.Id);
                // Merging two spellings is a guess the user should see, not a silent decision.
                if (!exercise.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) renamed.Add(new(name, exercise.Name));
            }

            resolved[name] = exercise;
        }

        if (created.Count > 0)
        {
            var custom = await db.Exercises.CountAsync(e => e.UserId == user.Id, ct);
            if (custom + created.Count > options.Limits.CustomExercises)
                errors.Add(new(0, $"The file adds {created.Count} new exercises, which would pass the limit of {options.Limits.CustomExercises} custom exercises."));
        }

        DateOnly LocalDay(DateTimeOffset at) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(at, zone).DateTime);

        var summary = new ImportSummaryDto(
            Committed: false,
            Rows: parsed.Rows,
            Workouts: fresh.Count,
            Sets: fresh.Sum(w => w.Exercises.Sum(e => e.Sets.Count)),
            From: fresh.Count == 0 ? null : LocalDay(fresh.Min(w => w.StartedAt)),
            To: fresh.Count == 0 ? null : LocalDay(fresh.Max(w => w.StartedAt)),
            Duplicates: duplicates,
            MatchedExercises: matched.Count,
            NewExercises: [.. created.Select(e => new ImportNewExerciseDto(e.Name, e.MuscleGroup, e.Modality))],
            Renamed: renamed,
            Errors: [.. errors.OrderBy(e => e.Line).Take(25)],
            ErrorCount: errors.Count);

        if (!commit || errors.Count > 0 || fresh.Count == 0) return Results.Ok(summary);

        // ---- write ----

        db.Exercises.AddRange(created);

        foreach (var source in fresh)
        {
            var finishedAt = source.StartedAt.AddMinutes(source.Minutes ?? 0);
            db.Workouts.Add(new Workout
            {
                Id = Guid.CreateVersion7(),
                UserId = user.Id,
                Name = source.Name,
                StartedAt = source.StartedAt,
                FinishedAt = finishedAt,
                Exercises = [.. source.Exercises.Select((exercise, position) => new WorkoutExercise
                {
                    Id = Guid.CreateVersion7(),
                    ExerciseId = resolved[exercise.Name].Id,
                    Position = position,
                    Sets = [.. exercise.Sets.Select((set, index) => new WorkoutSet
                    {
                        Id = Guid.CreateVersion7(),
                        Position = index,
                        WeightKg = set.WeightKg,
                        Reps = set.Reps,
                        DurationSeconds = set.DurationSeconds,
                        IsWarmup = set.IsWarmup,
                        IsCompleted = true,
                        CompletedAt = finishedAt,
                    })],
                })],
            });
        }

        // One SaveChanges is one transaction: the import lands whole or not at all.
        await db.SaveChangesAsync(ct);

        return Results.Ok(summary with { Committed = true });
    }

    /// <summary>
    /// The browser's named zone, so each date converts with its own daylight-saving offset; failing
    /// that, today's offset.
    /// </summary>
    private static TimeZoneInfo Zone(string? id, int? offsetMinutes)
    {
        if (id is { Length: > 0 and <= 64 } && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone)) return zone;

        var offset = TimeSpan.FromMinutes(Math.Clamp(offsetMinutes ?? 0, -840, 840));
        return TimeZoneInfo.CreateCustomTimeZone("client", offset, "client", "client");
    }
}
