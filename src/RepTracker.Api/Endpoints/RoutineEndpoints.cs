using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

public static class RoutineEndpoints
{
    public static void MapRoutines(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/routines").RequireAuthorization();

        group.MapGet("/", List);
        group.MapGet("/{id:guid}", Get);
        group.MapPost("/", Create);
        group.MapPut("/{id:guid}", Replace);
        group.MapDelete("/{id:guid}", Delete);
    }

    private static async Task<IResult> List(
        AppDb db, ClaimsPrincipal principal, CancellationToken ct, bool includeArchived = false)
    {
        var userId = principal.UserId();

        var routines = await Query(db, userId)
            .Where(r => includeArchived || !r.IsArchived)
            .OrderBy(r => r.Name)
            .ToListAsync(ct);

        return Results.Ok(routines.Select(r => r.ToDto()));
    }

    private static async Task<IResult> Get(Guid id, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var routine = await Query(db, principal.UserId()).FirstOrDefaultAsync(r => r.Id == id, ct);
        return routine is null ? Results.NotFound() : Results.Ok(routine.ToDto());
    }

    private static async Task<IResult> Create(
        SaveRoutineRequest body, AppDb db, ClaimsPrincipal principal, AppOptions options, CancellationToken ct)
    {
        var userId = principal.UserId();

        if (await db.Routines.CountAsync(r => r.UserId == userId, ct) >= options.Limits.Routines)
            return Validation.Problem($"You already have the maximum of {options.Limits.Routines} routines.");

        var name = Validation.Text(body.Name, 60);
        if (name is null) return Validation.Problem("A name is required.");

        var now = DateTimeOffset.UtcNow;
        var routine = new Routine
        {
            Id = Guid.CreateVersion7(),
            UserId = userId,
            Name = name,
            Notes = Validation.Text(body.Notes, 500),
            CreatedAt = now,
            UpdatedAt = now,
        };

        var applied = await ApplyExercisesAsync(db, routine, body.Exercises, userId, options, ct);
        if (applied is not null) return applied;

        db.Routines.Add(routine);
        await db.SaveChangesAsync(ct);

        var saved = await Query(db, userId).FirstAsync(r => r.Id == routine.Id, ct);
        return Results.Created($"/api/routines/{routine.Id}", saved.ToDto());
    }

    /// <summary>
    /// Whole-routine replace. Editing a template is a bulk operation on the phone - reorder, retarget,
    /// drop two movements - so one atomic write is both simpler and safer than a patch per row.
    /// </summary>
    private static async Task<IResult> Replace(
        Guid id, SaveRoutineRequest body, AppDb db, ClaimsPrincipal principal,
        AppOptions options, CancellationToken ct)
    {
        var userId = principal.UserId();

        var routine = await db.Routines
            .Include(r => r.Exercises)
            .FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId, ct);
        if (routine is null) return Results.NotFound();

        var name = Validation.Text(body.Name, 60);
        if (name is null) return Validation.Problem("A name is required.");

        routine.Name = name;
        routine.Notes = Validation.Text(body.Notes, 500);
        routine.UpdatedAt = DateTimeOffset.UtcNow;

        db.RoutineExercises.RemoveRange(routine.Exercises);
        routine.Exercises.Clear();

        var applied = await ApplyExercisesAsync(db, routine, body.Exercises, userId, options, ct);
        if (applied is not null) return applied;

        await db.SaveChangesAsync(ct);

        var saved = await Query(db, userId).FirstAsync(r => r.Id == id, ct);
        return Results.Ok(saved.ToDto());
    }

    private static async Task<IResult> Delete(Guid id, AppDb db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var deleted = await db.Routines
            .Where(r => r.Id == id && r.UserId == principal.UserId())
            .ExecuteDeleteAsync(ct);

        // Workouts started from this routine keep their history; the foreign key is set null.
        return deleted == 0 ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<IResult?> ApplyExercisesAsync(
        AppDb db, Routine routine, List<SaveRoutineExercise>? requested,
        Guid userId, AppOptions options, CancellationToken ct)
    {
        var items = requested ?? [];

        if (items.Count > options.Limits.ExercisesPerRoutine)
            return Validation.Problem($"A routine can hold at most {options.Limits.ExercisesPerRoutine} exercises.");

        if (items.Count == 0) return null;

        // One lookup confirms every referenced exercise both exists and is visible to this user,
        // which is what stops a caller from attaching another account's private exercise.
        var ids = items.Select(i => i.ExerciseId).Distinct().ToList();
        var visible = await db.Exercises
            .Where(e => ids.Contains(e.Id) && (e.UserId == null || e.UserId == userId))
            .Select(e => e.Id)
            .ToListAsync(ct);

        if (visible.Count != ids.Count) return Validation.Problem("One or more exercises could not be found.");

        var position = 0;
        foreach (var item in items)
        {
            routine.Exercises.Add(new RoutineExercise
            {
                Id = Guid.CreateVersion7(),
                RoutineId = routine.Id,
                ExerciseId = item.ExerciseId,
                Position = position++,
                TargetSets = Validation.TargetSets(item.TargetSets),
                TargetRepsMin = Validation.TargetReps(item.TargetRepsMin),
                TargetRepsMax = Validation.TargetReps(item.TargetRepsMax),
                TargetWeightKg = Validation.Weight(item.TargetWeightKg),
                RestSeconds = Validation.Rest(item.RestSeconds),
                Notes = Validation.Text(item.Notes, 200),
            });
        }

        return null;
    }

    private static IQueryable<Routine> Query(AppDb db, Guid userId) =>
        db.Routines
            .Where(r => r.UserId == userId)
            .Include(r => r.Exercises).ThenInclude(x => x.Exercise)
            .AsSplitQuery();
}
