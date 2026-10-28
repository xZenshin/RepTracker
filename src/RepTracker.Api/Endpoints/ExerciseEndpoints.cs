using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

public static class ExerciseEndpoints
{
    public static void MapExercises(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/exercises").RequireAuthorization();

        group.MapGet("/", List);
        group.MapPost("/", Create);
        group.MapPatch("/{id:guid}", Update);
        group.MapDelete("/{id:guid}", Delete);
        group.MapPost("/merge", Merge);
    }

    /// <summary>
    /// The shared catalogue plus this user's own additions, as one list - less any catalogue exercise
    /// they merged into another, which is hidden for them alone.
    /// </summary>
    private static async Task<IResult> List(
        AppDb db, ClaimsPrincipal principal, CancellationToken ct, bool includeArchived = false)
    {
        var userId = principal.UserId();

        var items = await db.Exercises
            .Where(e => (e.UserId == null || e.UserId == userId) && (includeArchived || !e.IsArchived))
            .Where(e => !db.ExerciseMerges.Any(m => m.UserId == userId && m.FromExerciseId == e.Id))
            .OrderBy(e => e.MuscleGroup).ThenBy(e => e.Name)
            .Select(e => new ExerciseDto(
                e.Id, e.Name, e.MuscleGroup, e.Equipment, e.Modality, e.Pattern, e.UserId != null, e.IsArchived))
            .ToListAsync(ct);

        return Results.Ok(items);
    }

    private static async Task<IResult> Create(
        CreateExerciseRequest body, AppDb db, ClaimsPrincipal principal, AppOptions options, CancellationToken ct)
    {
        var userId = principal.UserId();

        var name = Validation.Text(body.Name, 80);
        if (name is null) return Validation.Problem("A name is required.");

        var count = await db.Exercises.CountAsync(e => e.UserId == userId, ct);
        if (count >= options.Limits.CustomExercises)
            return Validation.Problem($"You already have the maximum of {options.Limits.CustomExercises} custom exercises.");

        var normalized = name.ToLowerInvariant();

        // Colliding with the shared catalogue is almost always a user about to create a duplicate
        // of something that already exists, which would split their history across two exercises.
        var clash = await db.Exercises.AnyAsync(
            e => e.NameNormalized == normalized && (e.UserId == null || e.UserId == userId), ct);
        if (clash) return Validation.Problem($"\"{name}\" already exists.");

        var exercise = new Exercise
        {
            Id = Guid.CreateVersion7(),
            UserId = userId,
            Name = name,
            NameNormalized = normalized,
            MuscleGroup = Validation.OneOf(body.MuscleGroup, ExerciseCatalog.MuscleGroups, "Other"),
            Equipment = Validation.OneOf(body.Equipment, Validation.Equipment, "Other"),
            Modality = Enum.IsDefined(body.Modality) ? body.Modality : Modality.WeightReps,
            Pattern = Validation.OneOf(body.Pattern, Validation.Patterns, "other"),
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Exercises.Add(exercise);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/api/exercises/{exercise.Id}", exercise.ToDto());
    }

    private static async Task<IResult> Update(
        Guid id, UpdateExerciseRequest body, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.UserId();

        // Scoped to the caller's own rows, so the shared catalogue is read-only to everyone.
        var exercise = await db.Exercises.FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId, ct);
        if (exercise is null) return Results.NotFound();

        if (body.Name is not null)
        {
            var name = Validation.Text(body.Name, 80);
            if (name is null) return Validation.Problem("A name is required.");

            var normalized = name.ToLowerInvariant();
            var clash = await db.Exercises.AnyAsync(
                e => e.Id != id && e.NameNormalized == normalized && (e.UserId == null || e.UserId == userId), ct);
            if (clash) return Validation.Problem($"\"{name}\" already exists.");

            exercise.Name = name;
            exercise.NameNormalized = normalized;
        }

        if (body.MuscleGroup is not null)
            exercise.MuscleGroup = Validation.OneOf(body.MuscleGroup, ExerciseCatalog.MuscleGroups, exercise.MuscleGroup);
        if (body.Equipment is not null)
            exercise.Equipment = Validation.OneOf(body.Equipment, Validation.Equipment, exercise.Equipment);
        if (body.Pattern is not null)
            exercise.Pattern = Validation.OneOf(body.Pattern, Validation.Patterns, exercise.Pattern);
        if (body.IsArchived is not null)
            exercise.IsArchived = body.IsArchived.Value;

        await db.SaveChangesAsync(ct);
        return Results.Ok(exercise.ToDto());
    }

    private static async Task<IResult> Delete(Guid id, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.UserId();

        var exercise = await db.Exercises.FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId, ct);
        if (exercise is null) return Results.NotFound();

        // Deleting an exercise that appears in past workouts would silently destroy that history,
        // so once it has been used the only way to retire it is to archive it.
        var inUse = await db.WorkoutExercises.AnyAsync(we => we.ExerciseId == id, ct)
                    || await db.RoutineExercises.AnyAsync(re => re.ExerciseId == id, ct);

        if (inUse)
        {
            exercise.IsArchived = true;
            await db.SaveChangesAsync(ct);
            return Results.Ok(exercise.ToDto());
        }

        db.Exercises.Remove(exercise);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// <summary>
    /// Folds one exercise into another: every set logged against <c>FromId</c> moves to <c>IntoId</c>,
    /// routines switch over, and the first exercise goes - deleted if it is the user's own, hidden for
    /// them if it is in the shared catalogue, which other accounts still use. Without
    /// <paramref name="commit"/> it only reports what would happen, for the confirmation step.
    ///
    /// A workout that had both ends up with one: the sets are combined under the kept exercise in the
    /// order they were done, so a session never lists the same lift twice. A routine that had both
    /// keeps its existing row for the kept exercise and drops the other.
    /// </summary>
    private static async Task<IResult> Merge(
        MergeExercisesRequest body, AppDb db, ClaimsPrincipal principal, CancellationToken ct, bool commit = false)
    {
        var userId = principal.UserId();
        if (body.FromId == body.IntoId) return Validation.Problem("Pick two different exercises.");

        var pair = await db.Exercises
            .Where(e => (e.Id == body.FromId || e.Id == body.IntoId) && (e.UserId == null || e.UserId == userId))
            .Where(e => !db.ExerciseMerges.Any(m => m.UserId == userId && m.FromExerciseId == e.Id))
            .ToListAsync(ct);
        var from = pair.FirstOrDefault(e => e.Id == body.FromId);
        var into = pair.FirstOrDefault(e => e.Id == body.IntoId);
        if (from is null || into is null) return Validation.Problem("That exercise could not be found.");

        // Each kind is stored in different fields - a plank's seconds are not a press's kilograms - so
        // merging across kinds would turn one history into nonsense under the other's name.
        if (from.Modality != into.Modality)
            return Validation.Problem($"{from.Name} and {into.Name} are logged differently, so their history cannot be combined.");

        var moving = await db.WorkoutExercises
            .Where(we => we.ExerciseId == from.Id && we.Workout.UserId == userId)
            .Select(we => new { we.Id, we.WorkoutId, we.Position, Sets = we.Sets.Count })
            .ToListAsync(ct);
        var workoutIds = moving.Select(x => x.WorkoutId).Distinct().ToList();

        // The kept exercise's row in each workout that has both; the first, if it somehow has two.
        var keptIn = (await db.WorkoutExercises
                .Where(we => we.ExerciseId == into.Id && workoutIds.Contains(we.WorkoutId))
                .Select(we => new { we.Id, we.WorkoutId, we.Position })
                .ToListAsync(ct))
            .GroupBy(x => x.WorkoutId)
            .ToDictionary(g => g.Key, g => g.MinBy(x => x.Position)!);

        var routineRows = await db.RoutineExercises
            .Where(re => re.ExerciseId == from.Id && re.Routine.UserId == userId)
            .Select(re => new { re.Id, re.RoutineId })
            .ToListAsync(ct);
        var routineIds = routineRows.Select(x => x.RoutineId).Distinct().ToList();
        var routinesWithBoth = await db.RoutineExercises
            .Where(re => re.ExerciseId == into.Id && routineIds.Contains(re.RoutineId))
            .Select(re => re.RoutineId)
            .Distinct()
            .ToListAsync(ct);

        var hidden = from.UserId is null;
        var summary = new MergeSummaryDto(
            commit, from.Name, into.Name, workoutIds.Count, moving.Sum(x => x.Sets),
            keptIn.Count, routineIds.Count, hidden);
        if (!commit) return Results.Ok(summary);

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        // Workouts with both: the merged-away row's sets join the kept row, then everything there is
        // renumbered by when it was done. Imported sets all share their workout's start time, so ties
        // fall back to where each exercise sat in the workout, then to the set's own place.
        var combining = moving.Where(x => keptIn.ContainsKey(x.WorkoutId)).ToList();
        if (combining.Count > 0)
        {
            var rowPosition = new Dictionary<Guid, int>();
            foreach (var x in combining)
            {
                rowPosition[x.Id] = x.Position;
                rowPosition[keptIn[x.WorkoutId].Id] = keptIn[x.WorkoutId].Position;
            }

            var rowIds = rowPosition.Keys.ToList();
            var sets = await db.Sets.Where(s => rowIds.Contains(s.WorkoutExerciseId)).ToListAsync(ct);
            foreach (var x in combining)
            {
                var keptRow = keptIn[x.WorkoutId].Id;
                var ordered = sets
                    .Where(s => s.WorkoutExerciseId == x.Id || s.WorkoutExerciseId == keptRow)
                    .OrderBy(s => s.CompletedAt ?? DateTimeOffset.MaxValue)
                    .ThenBy(s => rowPosition[s.WorkoutExerciseId])
                    .ThenBy(s => s.Position)
                    .ToList();

                for (var i = 0; i < ordered.Count; i++)
                {
                    ordered[i].WorkoutExerciseId = keptRow;
                    ordered[i].Position = i;
                }
            }

            await db.SaveChangesAsync(ct);

            var emptied = combining.Select(x => x.Id).ToList();
            await db.WorkoutExercises.Where(we => emptied.Contains(we.Id)).ExecuteDeleteAsync(ct);
        }

        var switching = moving.Where(x => !keptIn.ContainsKey(x.WorkoutId)).Select(x => x.Id).ToList();
        await db.WorkoutExercises
            .Where(we => switching.Contains(we.Id))
            .ExecuteUpdateAsync(u => u.SetProperty(we => we.ExerciseId, into.Id), ct);

        var dropRows = routineRows.Where(x => routinesWithBoth.Contains(x.RoutineId)).Select(x => x.Id).ToList();
        var switchRows = routineRows.Where(x => !routinesWithBoth.Contains(x.RoutineId)).Select(x => x.Id).ToList();
        await db.RoutineExercises.Where(re => dropRows.Contains(re.Id)).ExecuteDeleteAsync(ct);
        await db.RoutineExercises
            .Where(re => switchRows.Contains(re.Id))
            .ExecuteUpdateAsync(u => u.SetProperty(re => re.ExerciseId, into.Id), ct);

        // Anything merged into this exercise earlier now points on, so a redirect is always one hop.
        await db.ExerciseMerges
            .Where(m => m.UserId == userId && m.IntoExerciseId == from.Id)
            .ExecuteUpdateAsync(u => u.SetProperty(m => m.IntoExerciseId, into.Id), ct);

        db.ExerciseMerges.Add(new ExerciseMerge
        {
            UserId = userId,
            FromExerciseId = from.Id,
            FromName = from.Name,
            IntoExerciseId = into.Id,
            MergedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);

        if (!hidden) await db.Exercises.Where(e => e.Id == from.Id && e.UserId == userId).ExecuteDeleteAsync(ct);

        await tx.CommitAsync(ct);
        return Results.Ok(summary);
    }
}
