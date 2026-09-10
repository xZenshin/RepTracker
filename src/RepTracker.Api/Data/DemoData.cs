using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;

namespace RepTracker.Api.Data;

/// <summary>
/// Generates a plausible training history so the dashboard can be looked at with real shapes in it.
/// Development only - it backdates rows, which no API route is able to do.
/// </summary>
public static class DemoData
{
    private const int Weeks = 20;

    public static async Task<string> CreateAsync(AppDb db, Tokens tokens, CancellationToken ct = default)
    {
        var code = LoginCode.Generate();
        var now = DateTimeOffset.UtcNow;
        var random = new Random(20260910);

        var user = new User
        {
            Id = Guid.CreateVersion7(),
            LoginCodeHmac = tokens.HashLoginCode(code),
            DisplayName = "Demo",
            BodyWeightKg = 82m,
            CreatedAt = now.AddDays(-7 * Weeks),
            LastSeenAt = now,
        };
        db.Users.Add(user);

        var catalog = await db.Exercises
            .Where(e => e.UserId == null)
            .ToDictionaryAsync(e => e.Name, ct);

        // Three days, each with one main lift that progresses plus accessory work. The tuple is
        // (exercise, sets, reps, starting kg, kg added per week).
        var days = new[]
        {
            ("Push A", new[]
            {
                ("Barbell Bench Press", 4, 6, 80m, 1.25m),
                ("Overhead Press", 3, 8, 45m, 0.5m),
                ("Incline Dumbbell Press", 3, 10, 26m, 0.2m),
                ("Triceps Pushdown", 3, 12, 30m, 0.3m),
                ("Lateral Raise", 3, 15, 10m, 0.1m),
            }),
            ("Pull B", new[]
            {
                ("Deadlift", 3, 5, 120m, 2m),
                ("Pull-Up", 4, 8, 0m, 0.4m),
                ("Barbell Row", 3, 8, 70m, 0.9m),
                ("Face Pull", 3, 15, 20m, 0.2m),
                ("Barbell Curl", 3, 10, 30m, 0.25m),
            }),
            ("Legs C", new[]
            {
                ("Back Squat", 4, 5, 100m, 1.5m),
                ("Romanian Deadlift", 3, 8, 80m, 1m),
                ("Leg Press", 3, 12, 140m, 2.5m),
                ("Lying Leg Curl", 3, 12, 40m, 0.4m),
                ("Standing Calf Raise", 4, 15, 60m, 0.5m),
            }),
        };

        foreach (var (dayName, plan) in days)
        {
            var routine = new Routine
            {
                Id = Guid.CreateVersion7(),
                UserId = user.Id,
                Name = dayName,
                CreatedAt = user.CreatedAt,
                UpdatedAt = user.CreatedAt,
                Exercises = [.. plan.Select((p, i) => new RoutineExercise
                {
                    Id = Guid.CreateVersion7(),
                    ExerciseId = catalog[p.Item1].Id,
                    Position = i,
                    TargetSets = p.Item2,
                    TargetRepsMin = p.Item3,
                    TargetWeightKg = p.Item4,
                    RestSeconds = i == 0 ? 180 : 90,
                })],
            };
            db.Routines.Add(routine);

            for (var week = 0; week < Weeks; week++)
            {
                // Every fifth week is a deload and one week is missed altogether, so the volume
                // chart has the shape of real training rather than a straight ramp.
                if (week == 12) continue;
                var isDeload = week % 5 == 4;

                var start = user.CreatedAt
                    .AddDays(7 * week + Array.IndexOf(days.Select(d => d.Item1).ToArray(), dayName) * 2)
                    .AddHours(17 + random.NextDouble());

                if (start > now) continue;

                var workout = new Workout
                {
                    Id = Guid.CreateVersion7(),
                    UserId = user.Id,
                    RoutineId = routine.Id,
                    Name = dayName,
                    StartedAt = start,
                    FinishedAt = start.AddMinutes(52 + random.Next(0, 25)),
                };

                var position = 0;
                foreach (var (name, sets, reps, baseWeight, step) in plan)
                {
                    var we = new WorkoutExercise
                    {
                        Id = Guid.CreateVersion7(),
                        WorkoutId = workout.Id,
                        ExerciseId = catalog[name].Id,
                        Position = position,
                        RestSeconds = position == 0 ? 180 : 90,
                    };
                    position++;

                    // Overhead press stops progressing a third of the way in and stays there, which
                    // is what the stalling detector on the dashboard exists to surface.
                    var progressWeek = name == "Overhead Press" ? Math.Min(week, Weeks / 3) : week;
                    var weight = Math.Round((baseWeight + step * progressWeek) * (isDeload ? 0.85m : 1m) * 2, 0) / 2;

                    for (var s = 0; s < sets; s++)
                    {
                        var performed = Math.Max(1, reps - (s > 1 ? random.Next(0, 2) : 0));
                        we.Sets.Add(new WorkoutSet
                        {
                            Id = Guid.CreateVersion7(),
                            WorkoutExerciseId = we.Id,
                            Position = s,
                            WeightKg = weight,
                            Reps = performed,
                            Rpe = 7m + s * 0.5m > 10m ? 10m : 7m + s * 0.5m,
                            IsCompleted = true,
                            CompletedAt = start.AddMinutes(position * 8 + s * 2),
                        });
                    }

                    workout.Exercises.Add(we);
                }

                db.Workouts.Add(workout);
            }
        }

        await db.SaveChangesAsync(ct);
        return code;
    }
}
