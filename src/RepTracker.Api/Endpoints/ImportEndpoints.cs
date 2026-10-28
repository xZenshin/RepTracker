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
        var zone = Zones.FromClient(timeZone, offsetMinutes);
        var parsed = WorkoutCsv.Parse(text, user.Units, zone, now, options.Limits);
        var errors = parsed.Errors.Select(e => new ImportErrorDto(e.Line, e.Message)).ToList();

        // ---- exercises: the catalogue and the user's own; anything unmatched would be created ----

        var merges = await db.ExerciseMerges.Where(m => m.UserId == user.Id).Include(m => m.Into).ToListAsync(ct);
        var mergedAway = merges.Select(m => m.FromExerciseId).ToHashSet();
        var visible = await db.Exercises
            .Where(e => (e.UserId == null || e.UserId == user.Id) && !mergedAway.Contains(e.Id))
            .ToListAsync(ct);

        // Matching ignores spacing, hyphens and case. A user's own exercise wins over a catalogue one
        // that reduces to the same letters.
        var byLooseKey = visible
            .GroupBy(e => WorkoutCsv.LooseKey(e.Name))
            .ToDictionary(g => g.Key, g => g.OrderBy(e => e.UserId == null ? 1 : 0).First());

        // A name merged away lands on the exercise it was merged into - unless an exercise the user
        // can see now goes by that name, which is the more direct match.
        foreach (var merge in merges) byLooseKey.TryAdd(WorkoutCsv.LooseKey(merge.FromName), merge.Into);

        // Each spelling resolved once. A new exercise joins the lookup as soon as it is made, so
        // "Sled-Push" further down lands on the "Sled Push" made above it.
        var resolved = new Dictionary<string, Exercise>(StringComparer.OrdinalIgnoreCase);
        var candidates = new List<Exercise>();

        foreach (var name in parsed.Workouts.SelectMany(w => w.Exercises).Select(e => e.Name))
        {
            if (resolved.ContainsKey(name)) continue;

            var exercise = WorkoutCsv.Match(name, byLooseKey);
            if (exercise is null)
            {
                var guess = ExerciseGuess.For(name);
                exercise = new Exercise
                {
                    Id = Guid.CreateVersion7(),
                    UserId = user.Id,
                    Name = name,
                    NameNormalized = name.ToLowerInvariant(),
                    MuscleGroup = guess.MuscleGroup,
                    Pattern = guess.Pattern,
                    Equipment = guess.Equipment,
                    Modality = WorkoutCsv.InferModality(parsed.Hints[name.ToLowerInvariant()]),
                    CreatedAt = now,
                };
                candidates.Add(exercise);
                byLooseKey[WorkoutCsv.LooseKey(name)] = exercise;
            }

            resolved[name] = exercise;
        }

        // ---- each workout is named for what was trained in it ----

        foreach (var workout in parsed.Workouts)
        {
            var setsByPattern = workout.Exercises
                .GroupBy(e => resolved[e.Name].Pattern)
                .ToDictionary(g => g.Key, g => g.Sum(e => e.Sets.Count));
            workout.Name = ExerciseGuess.WorkoutName(setsByPattern);
        }

        // ---- a workout starting within a minute of one already here is the same workout ----
        // Matched on the start alone, not the name, so re-importing stays harmless even if the naming
        // above changes. Within a minute, because the export writes times to the minute: a workout
        // begun at 07:30:42 comes back as 07:30. Two real workouts never start a minute apart.

        var fresh = parsed.Workouts;
        if (fresh.Count > 0)
        {
            var from = fresh.Min(w => w.StartedAt).AddMinutes(-1).ToUniversalTime();
            var to = fresh.Max(w => w.StartedAt).AddMinutes(1).ToUniversalTime();
            var existing = (await db.Workouts
                    .Where(w => w.UserId == user.Id && w.StartedAt >= from && w.StartedAt <= to)
                    .Select(w => w.StartedAt)
                    .ToListAsync(ct))
                .Select(s => s.UtcTicks)
                .Order()
                .ToArray();

            bool Taken(DateTimeOffset at)
            {
                var i = Array.BinarySearch(existing, at.UtcTicks);
                if (i >= 0) return true;
                i = ~i;
                return (i < existing.Length && existing[i] - at.UtcTicks < TimeSpan.TicksPerMinute)
                    || (i > 0 && at.UtcTicks - existing[i - 1] < TimeSpan.TicksPerMinute);
            }

            fresh = [.. parsed.Workouts.Where(w => !Taken(w.StartedAt))];
        }
        var duplicates = parsed.Workouts.Count - fresh.Count;

        var total = await db.Workouts.CountAsync(w => w.UserId == user.Id, ct);
        if (total + fresh.Count > options.Limits.Workouts)
            errors.Add(new(0, $"Importing {fresh.Count} workouts would pass the limit of {options.Limits.Workouts} per account."));

        // Only what the new workouts use is created or reported.
        var used = fresh.SelectMany(w => w.Exercises).Select(e => resolved[e.Name]).ToHashSet();
        var created = candidates.Where(used.Contains).ToList();
        var matched = used.Where(e => !candidates.Contains(e)).ToList();

        // Merging two spellings is a guess the user should see, not a silent decision.
        var renamed = fresh.SelectMany(w => w.Exercises).Select(e => e.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(n => !resolved[n].Name.Equals(n, StringComparison.OrdinalIgnoreCase))
            .Select(n => new ImportRenamedDto(n, resolved[n].Name))
            .ToList();

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
            EmptySets: parsed.EmptySets,
            From: fresh.Count == 0 ? null : LocalDay(fresh.Min(w => w.StartedAt)),
            To: fresh.Count == 0 ? null : LocalDay(fresh.Max(w => w.StartedAt)),
            Duplicates: duplicates,
            MatchedExercises: matched.Count,
            NewExercises: [.. created.OrderBy(e => e.MuscleGroup == "Other").ThenBy(e => e.MuscleGroup).ThenBy(e => e.Name)
                .Select(e => new ImportNewExerciseDto(e.Name, e.MuscleGroup, e.Modality))],
            Renamed: renamed,
            WorkoutNames: fresh.GroupBy(w => w.Name).OrderByDescending(g => g.Count())
                .ToDictionary(g => g.Key, g => g.Count()),
            CorrectedDates: [.. parsed.CorrectedDates.Select(c => new ImportCorrectedDateDto(c.Written, c.Corrected))],
            Errors: [.. errors.OrderBy(e => e.Line).Take(25)],
            ErrorCount: errors.Count);

        if (!commit || errors.Count > 0 || fresh.Count == 0) return Results.Ok(summary);

        // ---- write ----

        db.Exercises.AddRange(created);

        foreach (var source in fresh)
        {
            db.Workouts.Add(new Workout
            {
                Id = Guid.CreateVersion7(),
                UserId = user.Id,
                Name = source.Name,
                StartedAt = source.StartedAt,
                // The export carries no duration, so the workout is recorded as taking none rather than
                // a made-up length that would feed the time-trained totals.
                FinishedAt = source.StartedAt,
                Exercises = [.. source.Exercises.Select((exercise, position) => new WorkoutExercise
                {
                    Id = Guid.CreateVersion7(),
                    ExerciseId = resolved[exercise.Name].Id,
                    Position = position,
                    Notes = Truncate(string.Join("; ", exercise.Notes), 200),
                    Sets = [.. exercise.Sets.Select((set, index) => new WorkoutSet
                    {
                        Id = Guid.CreateVersion7(),
                        Position = index,
                        WeightKg = set.WeightKg,
                        Reps = set.Reps,
                        DurationSeconds = set.DurationSeconds,
                        IsCompleted = true,
                        CompletedAt = source.StartedAt,
                    })],
                })],
            });
        }

        // One SaveChanges is one transaction: the import lands whole or not at all.
        await db.SaveChangesAsync(ct);

        return Results.Ok(summary with { Committed = true });
    }

    private static string? Truncate(string value, int max) =>
        value.Length == 0 ? null : value.Length <= max ? value : value[..(max - 1)] + "…";

}
