using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

public static class WorkoutEndpoints
{
    public static void MapWorkouts(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/workouts").RequireAuthorization();

        // A workout in progress lives on the phone and never touches the server; it arrives here
        // once, finished, in a single request. So there is nothing to start, edit or resume.
        group.MapGet("/", List);
        group.MapGet("/previous", Previous);
        group.MapPost("/", Save).WithMetadata(new RequestSizeLimitAttribute(MaxSaveBytes));
        group.MapGet("/{id:guid}", Get);
        group.MapDelete("/{id:guid}", Delete);
    }

    /// <summary>
    /// A finished workout is at most 40 exercises of 40 sets, around 200 KB of JSON at the very
    /// worst - over the global 64 KB cap, so this one endpoint raises it, as the CSV import does.
    /// It goes on as route metadata because the body is bound before the handler runs.
    /// </summary>
    private const long MaxSaveBytes = 256 * 1024;

    // ---- workout ----

    /// <summary>History, newest first, walked with a keyset cursor on start time.</summary>
    private static async Task<IResult> List(
        AppDb db, HttpContext ctx, ClaimsPrincipal principal, CancellationToken ct,
        int? limit = null, DateTimeOffset? before = null, DateTimeOffset? after = null)
    {
        var userId = principal.UserId();
        var take = Validation.PageSize(limit, fallback: 20, max: 100);

        var query = db.Workouts
            .Where(w => w.UserId == userId && w.FinishedAt != null)
            .Include(w => w.Routine)
            .Include(w => w.Exercises).ThenInclude(we => we.Exercise)
            .Include(w => w.Exercises).ThenInclude(we => we.Sets)
            .AsSplitQuery();

        // Normalised because a caller may send a cursor carrying its own zone, and Npgsql binds
        // timestamptz parameters only at zero offset.
        if (before is { } cursor) query = query.Where(w => w.StartedAt < cursor.ToUniversalTime());

        // With `before`, bounds one calendar month for the history page's calendar.
        if (after is { } from) query = query.Where(w => w.StartedAt >= from.ToUniversalTime());

        // One row beyond the page tells us whether a cursor is worth handing back.
        var rows = await query.OrderByDescending(w => w.StartedAt).Take(take + 1).ToListAsync(ct);

        var hasMore = rows.Count > take;
        if (hasMore) rows.RemoveAt(rows.Count - 1);

        var bodyWeight = ctx.CurrentUser().BodyWeightKg;
        var items = rows.Select(w => w.ToSummary(bodyWeight)).ToList();

        return Results.Ok(new PagedResult<WorkoutSummaryDto>(
            items, hasMore ? rows[^1].StartedAt.ToString("o") : null));
    }

    private static async Task<IResult> Get(
        Guid id, AppDb db, HttpContext ctx, ClaimsPrincipal principal, CancellationToken ct)
    {
        var workout = await FullQuery(db, principal.UserId()).FirstOrDefaultAsync(w => w.Id == id, ct);
        if (workout is null) return Results.NotFound();

        return Results.Ok(workout.ToDto(ctx.CurrentUser().BodyWeightKg));
    }

    /// <summary>
    /// Last time's completed sets for every exercise trained recently, keyed by exercise id. The phone
    /// fetches this once when a workout starts, so laying out a routine, adding an exercise and
    /// swapping one all prefill from it without another request.
    /// </summary>
    private static async Task<IResult> Previous(AppDb db, ClaimsPrincipal principal, CancellationToken ct) =>
        Results.Ok(await PreviousPerformance.LoadAsync(db, principal.UserId(), ct));

    /// <summary>
    /// Stores a finished workout, sent whole by the phone. Only completed sets are sent; an exercise
    /// left with none is dropped, as finishing always has.
    ///
    /// The id is the phone's own, which makes this safe to retry: gym signal can lose the response
    /// to a save that worked, and sending it again hands back the stored workout rather than a copy.
    /// </summary>
    private static async Task<IResult> Save(
        SaveWorkoutRequest body, AppDb db, HttpContext ctx, ClaimsPrincipal principal,
        AppOptions options, CancellationToken ct)
    {
        var userId = principal.UserId();
        var bodyWeight = ctx.CurrentUser().BodyWeightKg;

        var existing = await FullQuery(db, userId).FirstOrDefaultAsync(w => w.Id == body.Id, ct);
        if (existing is not null) return Results.Ok(existing.ToDto(bodyWeight));
        if (await db.Workouts.AnyAsync(w => w.Id == body.Id, ct)) return Validation.Problem("That workout id is taken.");

        if (await db.Workouts.CountAsync(w => w.UserId == userId, ct) >= options.Limits.Workouts)
            return Validation.Problem($"You have reached the maximum of {options.Limits.Workouts} stored workouts.");

        // A workout open on the phone since before a merge still names the exercise merged away.
        var redirects = await ExerciseMerges.RedirectsAsync(db, userId, ct);
        var exercises = body.Exercises
            .Where(x => x.Sets.Count > 0)
            .Select(x => x with { ExerciseId = redirects.Resolve(x.ExerciseId) })
            .ToList();
        if (exercises.Count > options.Limits.ExercisesPerWorkout)
            return Validation.Problem($"A workout can hold at most {options.Limits.ExercisesPerWorkout} exercises.");
        if (exercises.Any(x => x.Sets.Count > options.Limits.SetsPerExercise))
            return Validation.Problem($"An exercise can hold at most {options.Limits.SetsPerExercise} sets.");

        var exerciseIds = exercises.Select(x => x.ExerciseId).Distinct().ToList();
        var known = await db.Exercises
            .Where(e => exerciseIds.Contains(e.Id) && (e.UserId == null || e.UserId == userId))
            .Select(e => e.Id)
            .ToListAsync(ct);
        if (known.Count != exerciseIds.Count) return Validation.Problem("An exercise in this workout could not be found.");

        // A routine deleted while the workout was under way is no reason to lose the workout.
        var routine = body.RoutineId is { } routineId
            ? await db.Routines.FirstOrDefaultAsync(r => r.Id == routineId && r.UserId == userId, ct)
            : null;

        // The phone's clock decides when things happened, kept inside what is possible: nothing in
        // the future, and no set before the workout started.
        var now = DateTimeOffset.UtcNow;
        var startedAt = (body.StartedAt > now ? now : body.StartedAt).ToUniversalTime();

        var workout = new Workout
        {
            Id = body.Id,
            UserId = userId,
            RoutineId = routine?.Id,
            Name = Validation.Text(body.Name, 60) ?? routine?.Name ?? "Workout",
            Notes = Validation.Text(body.Notes, 1000),
            StartedAt = startedAt,
            FinishedAt = now,
        };

        foreach (var (x, position) in exercises.Select((x, i) => (x, i)))
        {
            var we = new WorkoutExercise
            {
                Id = Guid.CreateVersion7(),
                WorkoutId = workout.Id,
                ExerciseId = x.ExerciseId,
                Position = position,
                RestSeconds = Validation.Rest(x.RestSeconds),
                Notes = Validation.Text(x.Notes, 200),
            };

            we.Sets.AddRange(x.Sets.Select((s, i) => new WorkoutSet
            {
                Id = Guid.CreateVersion7(),
                WorkoutExerciseId = we.Id,
                Position = i,
                WeightKg = Validation.Weight(s.WeightKg),
                Reps = Validation.Reps(s.Reps),
                DurationSeconds = Validation.Duration(s.DurationSeconds),
                DistanceM = Validation.Distance(s.DistanceM),
                Rpe = Validation.Rpe(s.Rpe),
                IsCompleted = true,
                CompletedAt = s.CompletedAt is { } done
                    ? (done < startedAt ? startedAt : done > now ? now : done).ToUniversalTime()
                    : now,
            }));

            workout.Exercises.Add(we);
        }

        db.Workouts.Add(workout);
        await db.SaveChangesAsync(ct);

        var saved = await FullQuery(db, userId).FirstAsync(w => w.Id == workout.Id, ct);
        return Results.Created($"/api/workouts/{workout.Id}", saved.ToDto(bodyWeight));
    }

    private static async Task<IResult> Delete(
        Guid id, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var deleted = await db.Workouts
            .Where(w => w.Id == id && w.UserId == principal.UserId())
            .ExecuteDeleteAsync(ct);

        return deleted == 0 ? Results.NotFound() : Results.NoContent();
    }

    // ---- shared ----

    private static IQueryable<Workout> FullQuery(AppDb db, Guid userId) =>
        db.Workouts
            .Where(w => w.UserId == userId)
            .Include(w => w.Routine)
            .Include(w => w.Exercises).ThenInclude(we => we.Exercise)
            .Include(w => w.Exercises).ThenInclude(we => we.Sets)
            .AsSplitQuery();
}
