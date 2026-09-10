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
    }

    /// <summary>The shared catalogue plus this user's own additions, as one list.</summary>
    private static async Task<IResult> List(
        AppDb db, ClaimsPrincipal principal, CancellationToken ct, bool includeArchived = false)
    {
        var userId = principal.UserId();

        var items = await db.Exercises
            .Where(e => (e.UserId == null || e.UserId == userId) && (includeArchived || !e.IsArchived))
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
}
