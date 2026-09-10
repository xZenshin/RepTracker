using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

/// <summary>
/// Answers "what did I do last time?" for a set of exercises. This is the single most useful thing
/// to have on screen mid-workout, so it is folded into the active-workout response rather than
/// left to a follow-up request per exercise.
/// </summary>
public static class PreviousPerformance
{
    /// <summary>How far back to look. Older than this and "last time" is not a useful reference anyway.</summary>
    private static readonly TimeSpan LookBack = TimeSpan.FromDays(400);

    public static async Task<Dictionary<Guid, PreviousPerformanceDto>> LoadAsync(
        AppDb db, Guid userId, IReadOnlyCollection<Guid> exerciseIds, Guid excludeWorkoutId, CancellationToken ct)
    {
        if (exerciseIds.Count == 0) return [];

        var since = DateTimeOffset.UtcNow - LookBack;

        // Narrow projection: three columns per past appearance of these exercises, which stays small
        // even for a long training history, and keeps the query trivially translatable.
        var candidates = await db.WorkoutExercises
            .Where(we => we.Workout.UserId == userId
                         && we.WorkoutId != excludeWorkoutId
                         && we.Workout.FinishedAt != null
                         && we.Workout.StartedAt >= since
                         && exerciseIds.Contains(we.ExerciseId)
                         && we.Sets.Any(s => s.IsCompleted))
            .Select(we => new { we.Id, we.ExerciseId, we.Workout.StartedAt })
            .ToListAsync(ct);

        if (candidates.Count == 0) return [];

        var mostRecent = candidates
            .GroupBy(c => c.ExerciseId)
            .Select(g => g.MaxBy(c => c.StartedAt)!)
            .ToDictionary(c => c.Id, c => c);

        var setsByWorkoutExercise = await db.Sets
            .Where(s => mostRecent.Keys.Contains(s.WorkoutExerciseId) && s.IsCompleted)
            .OrderBy(s => s.Position)
            .Select(s => new { s.WorkoutExerciseId, s.WeightKg, s.Reps, s.DurationSeconds, s.DistanceM, s.IsWarmup })
            .ToListAsync(ct);

        return setsByWorkoutExercise
            .GroupBy(s => s.WorkoutExerciseId)
            .ToDictionary(
                g => mostRecent[g.Key].ExerciseId,
                g => new PreviousPerformanceDto(
                    mostRecent[g.Key].StartedAt,
                    [.. g.Select(s => new PreviousSetDto(s.WeightKg, s.Reps, s.DurationSeconds, s.DistanceM, s.IsWarmup))]));
    }
}
