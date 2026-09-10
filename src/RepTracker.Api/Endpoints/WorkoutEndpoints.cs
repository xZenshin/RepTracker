using System.Security.Claims;
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

        group.MapGet("/", List);
        group.MapGet("/active", GetActive);
        group.MapPost("/", Start);
        group.MapGet("/{id:guid}", Get);
        group.MapPatch("/{id:guid}", Update);
        group.MapDelete("/{id:guid}", Delete);

        group.MapPost("/{id:guid}/exercises", AddExercise);
        group.MapPut("/{id:guid}/exercises/order", ReorderExercises);
        group.MapPatch("/{id:guid}/exercises/{weId:guid}", UpdateExercise);
        group.MapDelete("/{id:guid}/exercises/{weId:guid}", RemoveExercise);

        group.MapPost("/{id:guid}/exercises/{weId:guid}/sets", AddSet);
        group.MapPatch("/{id:guid}/exercises/{weId:guid}/sets/{setId:guid}", UpdateSet);
        group.MapDelete("/{id:guid}/exercises/{weId:guid}/sets/{setId:guid}", RemoveSet);
    }

    // ---- workout ----

    /// <summary>History, newest first, walked with a keyset cursor on start time.</summary>
    private static async Task<IResult> List(
        AppDb db, HttpContext ctx, ClaimsPrincipal principal, CancellationToken ct,
        int? limit = null, DateTimeOffset? before = null)
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

        // One row beyond the page tells us whether a cursor is worth handing back.
        var rows = await query.OrderByDescending(w => w.StartedAt).Take(take + 1).ToListAsync(ct);

        var hasMore = rows.Count > take;
        if (hasMore) rows.RemoveAt(rows.Count - 1);

        var bodyWeight = ctx.CurrentUser().BodyWeightKg;
        var items = rows.Select(w => w.ToSummary(bodyWeight)).ToList();

        return Results.Ok(new PagedResult<WorkoutSummaryDto>(
            items, hasMore ? rows[^1].StartedAt.ToString("o") : null));
    }

    private static async Task<IResult> GetActive(
        AppDb db, HttpContext ctx, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.UserId();
        var workout = await FullQuery(db, userId).FirstOrDefaultAsync(w => w.FinishedAt == null, ct);

        // No active workout is a normal state, not an error: the client shows the start screen.
        if (workout is null) return Results.Ok(null as WorkoutDto);

        return Results.Ok(await WithPreviousAsync(db, ctx, workout, ct));
    }

    private static async Task<IResult> Get(
        Guid id, AppDb db, HttpContext ctx, ClaimsPrincipal principal, CancellationToken ct)
    {
        var workout = await FullQuery(db, principal.UserId()).FirstOrDefaultAsync(w => w.Id == id, ct);
        if (workout is null) return Results.NotFound();

        return Results.Ok(workout.ToDto(ctx.CurrentUser().BodyWeightKg));
    }

    private static async Task<IResult> Start(
        StartWorkoutRequest? body, AppDb db, HttpContext ctx, ClaimsPrincipal principal,
        AppOptions options, CancellationToken ct)
    {
        var userId = principal.UserId();

        // One workout at a time. The database enforces this too, but answering with the existing
        // workout lets a client that lost its place simply resume.
        var existing = await FullQuery(db, userId).FirstOrDefaultAsync(w => w.FinishedAt == null, ct);
        if (existing is not null)
            return Results.Conflict(await WithPreviousAsync(db, ctx, existing, ct));

        if (await db.Workouts.CountAsync(w => w.UserId == userId, ct) >= options.Limits.Workouts)
            return Validation.Problem($"You have reached the maximum of {options.Limits.Workouts} stored workouts.");

        var now = DateTimeOffset.UtcNow;
        var workout = new Workout
        {
            Id = Guid.CreateVersion7(),
            UserId = userId,
            StartedAt = now,
            Name = Validation.Text(body?.Name, 60) ?? "Workout",
        };

        if (body?.RoutineId is { } routineId)
        {
            var routine = await db.Routines
                .Include(r => r.Exercises).ThenInclude(re => re.Exercise)
                .FirstOrDefaultAsync(r => r.Id == routineId && r.UserId == userId, ct);

            if (routine is null) return Validation.Problem("That routine could not be found.");

            workout.RoutineId = routine.Id;
            workout.Name = Validation.Text(body.Name, 60) ?? routine.Name;

            // Lay the template out as empty sets, so the session becomes a matter of filling in
            // blanks rather than adding rows one tap at a time between working sets.
            foreach (var re in routine.Exercises.OrderBy(x => x.Position))
            {
                var we = new WorkoutExercise
                {
                    Id = Guid.CreateVersion7(),
                    WorkoutId = workout.Id,
                    ExerciseId = re.ExerciseId,
                    Position = re.Position,
                    RestSeconds = re.RestSeconds,
                    Notes = re.Notes,
                };

                for (var i = 0; i < Math.Min(re.TargetSets, options.Limits.SetsPerExercise); i++)
                {
                    we.Sets.Add(new WorkoutSet
                    {
                        Id = Guid.CreateVersion7(),
                        WorkoutExerciseId = we.Id,
                        Position = i,
                        WeightKg = re.TargetWeightKg,
                        Reps = re.TargetRepsMin,
                    });
                }

                workout.Exercises.Add(we);
            }
        }

        db.Workouts.Add(workout);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two taps on Start can race past the check above, and the one-active-workout index
            // catches the second. That is not worth showing as an error - hand back the workout
            // that won. Anything else is a real failure and is left to bubble up.
            db.ChangeTracker.Clear();

            var active = await FullQuery(db, userId).FirstOrDefaultAsync(w => w.FinishedAt == null, ct);
            if (active is null) throw;

            return Results.Conflict(await WithPreviousAsync(db, ctx, active, ct));
        }

        var saved = await FullQuery(db, userId).FirstAsync(w => w.Id == workout.Id, ct);
        return Results.Created($"/api/workouts/{workout.Id}", await WithPreviousAsync(db, ctx, saved, ct));
    }

    private static async Task<IResult> Update(
        Guid id, UpdateWorkoutRequest body, AppDb db, HttpContext ctx,
        ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.UserId();
        var workout = await FullQuery(db, userId).FirstOrDefaultAsync(w => w.Id == id, ct);
        if (workout is null) return Results.NotFound();

        if (body.Name is not null) workout.Name = Validation.Text(body.Name, 60) ?? workout.Name;
        if (body.Notes is not null) workout.Notes = Validation.Text(body.Notes, 1000);

        if (body.Finish == true)
        {
            if (workout.FinishedAt is not null) return Validation.Problem("That workout is already finished.");

            // Sets that were laid out but never performed are noise in every statistic downstream,
            // so finishing prunes them along with any exercise that ends up empty.
            foreach (var we in workout.Exercises.ToList())
            {
                foreach (var set in we.Sets.Where(s => !s.IsCompleted).ToList())
                {
                    we.Sets.Remove(set);
                    db.Sets.Remove(set);
                }

                if (we.Sets.Count == 0)
                {
                    workout.Exercises.Remove(we);
                    db.WorkoutExercises.Remove(we);
                }
            }

            workout.FinishedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        return Results.Ok(workout.ToDto(ctx.CurrentUser().BodyWeightKg));
    }

    private static async Task<IResult> Delete(
        Guid id, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var deleted = await db.Workouts
            .Where(w => w.Id == id && w.UserId == principal.UserId())
            .ExecuteDeleteAsync(ct);

        return deleted == 0 ? Results.NotFound() : Results.NoContent();
    }

    // ---- exercises within a workout ----

    private static async Task<IResult> AddExercise(
        Guid id, AddWorkoutExerciseRequest body, AppDb db, HttpContext ctx,
        ClaimsPrincipal principal, AppOptions options, CancellationToken ct)
    {
        var userId = principal.UserId();
        var workout = await EditableAsync(db, userId, id, ct);
        if (workout is null) return Results.NotFound();

        if (workout.Exercises.Count >= options.Limits.ExercisesPerWorkout)
            return Validation.Problem($"A workout can hold at most {options.Limits.ExercisesPerWorkout} exercises.");

        var exercise = await db.Exercises.FirstOrDefaultAsync(
            e => e.Id == body.ExerciseId && (e.UserId == null || e.UserId == userId), ct);
        if (exercise is null) return Validation.Problem("That exercise could not be found.");

        var we = new WorkoutExercise
        {
            Id = Guid.CreateVersion7(),
            WorkoutId = workout.Id,
            ExerciseId = exercise.Id,
            Position = workout.Exercises.Count == 0 ? 0 : workout.Exercises.Max(x => x.Position) + 1,
        };

        db.WorkoutExercises.Add(we);
        await db.SaveChangesAsync(ct);

        var saved = await FullQuery(db, userId).FirstAsync(w => w.Id == id, ct);
        return Results.Ok(await WithPreviousAsync(db, ctx, saved, ct));
    }

    private static async Task<IResult> ReorderExercises(
        Guid id, List<Guid> order, AppDb db, HttpContext ctx,
        ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.UserId();
        var workout = await EditableAsync(db, userId, id, ct);
        if (workout is null) return Results.NotFound();

        var byId = workout.Exercises.ToDictionary(x => x.Id);
        if (order.Count != byId.Count || order.Any(x => !byId.ContainsKey(x)))
            return Validation.Problem("The new order must list every exercise in the workout exactly once.");

        for (var i = 0; i < order.Count; i++) byId[order[i]].Position = i;

        await db.SaveChangesAsync(ct);

        var saved = await FullQuery(db, userId).FirstAsync(w => w.Id == id, ct);
        return Results.Ok(saved.ToDto(ctx.CurrentUser().BodyWeightKg));
    }

    private static async Task<IResult> UpdateExercise(
        Guid id, Guid weId, UpdateWorkoutExerciseRequest body, AppDb db,
        ClaimsPrincipal principal, CancellationToken ct)
    {
        var workout = await EditableAsync(db, principal.UserId(), id, ct);
        var we = workout?.Exercises.FirstOrDefault(x => x.Id == weId);
        if (we is null) return Results.NotFound();

        if (body.RestSeconds is not null) we.RestSeconds = Validation.Rest(body.RestSeconds.Value);
        if (body.Notes is not null) we.Notes = Validation.Text(body.Notes, 200);
        if (body.Position is not null) we.Position = Math.Clamp(body.Position.Value, 0, 1000);

        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> RemoveExercise(
        Guid id, Guid weId, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var workout = await EditableAsync(db, principal.UserId(), id, ct);
        var we = workout?.Exercises.FirstOrDefault(x => x.Id == weId);
        if (we is null) return Results.NotFound();

        db.WorkoutExercises.Remove(we);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ---- sets ----

    private static async Task<IResult> AddSet(
        Guid id, Guid weId, CreateSetRequest body, AppDb db, ClaimsPrincipal principal,
        AppOptions options, CancellationToken ct)
    {
        var workout = await EditableAsync(db, principal.UserId(), id, ct);
        var we = workout?.Exercises.FirstOrDefault(x => x.Id == weId);
        if (we is null) return Results.NotFound();

        if (we.Sets.Count >= options.Limits.SetsPerExercise)
            return Validation.Problem($"An exercise can hold at most {options.Limits.SetsPerExercise} sets.");

        var completed = body.IsCompleted ?? false;
        var set = new WorkoutSet
        {
            Id = Guid.CreateVersion7(),
            WorkoutExerciseId = we.Id,
            Position = we.Sets.Count == 0 ? 0 : we.Sets.Max(s => s.Position) + 1,
            WeightKg = Validation.Weight(body.WeightKg),
            Reps = Validation.Reps(body.Reps),
            DurationSeconds = Validation.Duration(body.DurationSeconds),
            DistanceM = Validation.Distance(body.DistanceM),
            Rpe = Validation.Rpe(body.Rpe),
            IsWarmup = body.IsWarmup ?? false,
            IsCompleted = completed,
            CompletedAt = completed ? DateTimeOffset.UtcNow : null,
        };

        db.Sets.Add(set);
        await db.SaveChangesAsync(ct);

        return Results.Ok(set.ToDto());
    }

    private static async Task<IResult> UpdateSet(
        Guid id, Guid weId, Guid setId, UpdateSetRequest body, AppDb db,
        ClaimsPrincipal principal, CancellationToken ct)
    {
        var workout = await EditableAsync(db, principal.UserId(), id, ct);
        var set = workout?.Exercises.FirstOrDefault(x => x.Id == weId)?.Sets.FirstOrDefault(s => s.Id == setId);
        if (set is null) return Results.NotFound();

        if (body.WeightKg is not null) set.WeightKg = Validation.Weight(body.WeightKg);
        if (body.Reps is not null) set.Reps = Validation.Reps(body.Reps);
        if (body.DurationSeconds is not null) set.DurationSeconds = Validation.Duration(body.DurationSeconds);
        if (body.DistanceM is not null) set.DistanceM = Validation.Distance(body.DistanceM);
        if (body.Rpe is not null) set.Rpe = Validation.Rpe(body.Rpe);
        if (body.IsWarmup is not null) set.IsWarmup = body.IsWarmup.Value;

        if (body.IsCompleted is { } isCompleted && isCompleted != set.IsCompleted)
        {
            set.IsCompleted = isCompleted;
            // The completion stamp is what the rest timer keys off, so it marks when the set was
            // ticked rather than when the empty row happened to be created.
            set.CompletedAt = isCompleted ? DateTimeOffset.UtcNow : null;
        }

        await db.SaveChangesAsync(ct);
        return Results.Ok(set.ToDto());
    }

    private static async Task<IResult> RemoveSet(
        Guid id, Guid weId, Guid setId, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var workout = await EditableAsync(db, principal.UserId(), id, ct);
        var we = workout?.Exercises.FirstOrDefault(x => x.Id == weId);
        var set = we?.Sets.FirstOrDefault(s => s.Id == setId);
        if (we is null || set is null) return Results.NotFound();

        db.Sets.Remove(set);
        we.Sets.Remove(set);

        // Renumber so positions stay a dense 0..n-1 sequence and the UI can label sets by index.
        var position = 0;
        foreach (var remaining in we.Sets.OrderBy(s => s.Position)) remaining.Position = position++;

        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ---- shared ----

    private static IQueryable<Workout> FullQuery(AppDb db, Guid userId) =>
        db.Workouts
            .Where(w => w.UserId == userId)
            .Include(w => w.Routine)
            .Include(w => w.Exercises).ThenInclude(we => we.Exercise)
            .Include(w => w.Exercises).ThenInclude(we => we.Sets)
            .AsSplitQuery();

    /// <summary>
    /// Loads a workout for mutation. Finished workouts stay editable so a mislogged set can be
    /// corrected afterwards, but ownership is re-checked here rather than trusted from the route.
    /// </summary>
    private static Task<Workout?> EditableAsync(AppDb db, Guid userId, Guid workoutId, CancellationToken ct) =>
        db.Workouts
            .Where(w => w.Id == workoutId && w.UserId == userId)
            .Include(w => w.Exercises).ThenInclude(we => we.Sets)
            .AsSplitQuery()
            .FirstOrDefaultAsync(ct);

    private static async Task<WorkoutDto> WithPreviousAsync(
        AppDb db, HttpContext ctx, Workout workout, CancellationToken ct)
    {
        var user = ctx.CurrentUser();
        var exerciseIds = workout.Exercises.Select(x => x.ExerciseId).Distinct().ToList();
        var previous = await PreviousPerformance.LoadAsync(db, user.Id, exerciseIds, workout.Id, ct);
        return workout.ToDto(user.BodyWeightKg, previous);
    }
}
