using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

/// <summary>
/// Answers "what did I do last time?" for every exercise trained in the look-back window. This is the
/// single most useful thing to have on screen mid-workout, and the phone runs the workout without
/// the server, so it takes the lot in one request when the workout starts: one entry per exercise,
/// a handful of sets each, which stays small even for a long training history.
/// </summary>
public static class PreviousPerformance
{
    /// <summary>How far back to look. Older than this and "last time" is not a useful reference anyway.</summary>
    private static readonly TimeSpan LookBack = TimeSpan.FromDays(400);

    public static async Task<Dictionary<Guid, PreviousPerformanceDto>> LoadAsync(
        AppDb db, Guid userId, CancellationToken ct)
    {
        var since = DateTimeOffset.UtcNow - LookBack;

        // Narrow projection: three columns per past appearance of an exercise, which keeps the query
        // trivially translatable.
        var candidates = await db.WorkoutExercises
            .Where(we => we.Workout.UserId == userId
                         && we.Workout.FinishedAt != null
                         && we.Workout.StartedAt >= since
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
            .Select(s => new { s.WorkoutExerciseId, s.WeightKg, s.Reps, s.DurationSeconds, s.DistanceM })
            .ToListAsync(ct);

        return setsByWorkoutExercise
            .GroupBy(s => s.WorkoutExerciseId)
            .ToDictionary(
                g => mostRecent[g.Key].ExerciseId,
                g => new PreviousPerformanceDto(
                    mostRecent[g.Key].StartedAt,
                    [.. g.Select(s => new PreviousSetDto(s.WeightKg, s.Reps, s.DurationSeconds, s.DistanceM))]));
    }
}
