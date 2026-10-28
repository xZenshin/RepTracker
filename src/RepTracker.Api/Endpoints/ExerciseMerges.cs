using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

/// <summary>
/// Where a user's merged-away exercises now point. Anything that accepts exercise ids from a client
/// runs them through here first, because a client can hold an id from before the merge: a workout
/// open on the phone since yesterday, or a routine editor left open in another tab.
/// </summary>
public static class ExerciseMerges
{
    public static Task<Dictionary<Guid, Guid>> RedirectsAsync(AppDb db, Guid userId, CancellationToken ct) =>
        db.ExerciseMerges
            .Where(m => m.UserId == userId)
            .ToDictionaryAsync(m => m.FromExerciseId, m => m.IntoExerciseId, ct);

    public static Guid Resolve(this Dictionary<Guid, Guid> redirects, Guid exerciseId) =>
        redirects.GetValueOrDefault(exerciseId, exerciseId);
}
