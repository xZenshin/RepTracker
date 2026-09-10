using Microsoft.EntityFrameworkCore;

namespace RepTracker.Api.Data;

public static class Seeder
{
    /// <summary>
    /// Brings the shared catalogue in line with <see cref="ExerciseCatalog"/> on startup. New entries
    /// are inserted and existing ones have their classification refreshed; nothing is ever deleted,
    /// because a workout somewhere may still reference it.
    /// </summary>
    public static async Task SeedCatalogAsync(AppDb db, CancellationToken ct = default)
    {
        var existing = await db.Exercises
            .Where(e => e.UserId == null)
            .ToDictionaryAsync(e => e.NameNormalized, ct);

        var now = DateTimeOffset.UtcNow;
        var added = 0;

        foreach (var seed in ExerciseCatalog.All)
        {
            var key = seed.Name.ToLowerInvariant();

            if (existing.TryGetValue(key, out var current))
            {
                current.MuscleGroup = seed.MuscleGroup;
                current.Equipment = seed.Equipment;
                current.Modality = seed.Modality;
                current.Pattern = seed.Pattern;
                continue;
            }

            db.Exercises.Add(new Exercise
            {
                Id = Guid.CreateVersion7(),
                UserId = null,
                Name = seed.Name,
                NameNormalized = key,
                MuscleGroup = seed.MuscleGroup,
                Equipment = seed.Equipment,
                Modality = seed.Modality,
                Pattern = seed.Pattern,
                CreatedAt = now,
            });
            added++;
        }

        if (db.ChangeTracker.HasChanges()) await db.SaveChangesAsync(ct);
    }

    /// <summary>Clears sessions that have already expired, so the table does not grow without bound.</summary>
    public static Task PurgeExpiredSessionsAsync(AppDb db, CancellationToken ct = default) =>
        db.Sessions.Where(s => s.ExpiresAt < DateTimeOffset.UtcNow).ExecuteDeleteAsync(ct);
}
