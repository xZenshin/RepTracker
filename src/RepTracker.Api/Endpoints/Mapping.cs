using RepTracker.Api.Data;
using RepTracker.Api.Stats;

namespace RepTracker.Api.Endpoints;

public static class Mapping
{
    public static UserDto ToDto(this User u) =>
        new(u.Id, u.DisplayName, u.Units, u.BodyWeightKg, u.CreatedAt);

    public static ExerciseDto ToDto(this Exercise e) =>
        new(e.Id, e.Name, e.MuscleGroup, e.Equipment, e.Modality, e.Pattern, e.UserId is not null, e.IsArchived);

    public static RoutineDto ToDto(this Routine r) =>
        new(r.Id, r.Name, r.Notes, r.IsArchived, r.UpdatedAt,
            [.. r.Exercises.OrderBy(x => x.Position).Select(x => new RoutineExerciseDto(
                x.Id, x.ExerciseId, x.Exercise.Name, x.Exercise.MuscleGroup, x.Exercise.Modality,
                x.Position, x.TargetSets, x.TargetRepsMin, x.TargetRepsMax,
                x.TargetWeightKg, x.RestSeconds, x.Notes))]);

    public static SetDto ToDto(this WorkoutSet s) =>
        new(s.Id, s.Position, s.WeightKg, s.Reps, s.DurationSeconds,
            s.DistanceM, s.Rpe, s.IsWarmup, s.IsCompleted, s.CompletedAt);

    public static WorkoutDto ToDto(
        this Workout w,
        decimal? bodyWeightKg,
        IReadOnlyDictionary<Guid, PreviousPerformanceDto>? previous = null)
    {
        var exercises = w.Exercises
            .OrderBy(x => x.Position)
            .Select(x => new WorkoutExerciseDto(
                x.Id, x.ExerciseId, x.Exercise.Name, x.Exercise.MuscleGroup, x.Exercise.Equipment,
                x.Exercise.Modality, x.Position, x.RestSeconds, x.Notes,
                [.. x.Sets.OrderBy(s => s.Position).Select(ToDto)],
                previous is not null && previous.TryGetValue(x.ExerciseId, out var p) ? p : null))
            .ToList();

        return new WorkoutDto(
            w.Id, w.Name, w.Notes, w.StartedAt, w.FinishedAt, w.RoutineId, w.Routine?.Name,
            Totals(w, bodyWeightKg), exercises);
    }

    public static WorkoutTotals Totals(Workout w, decimal? bodyWeightKg)
    {
        decimal volume = 0;
        int sets = 0, reps = 0;

        foreach (var we in w.Exercises)
        foreach (var s in we.Sets)
        {
            if (!s.IsCompleted || s.IsWarmup) continue;
            sets++;
            reps += s.Reps ?? 0;
            volume += Formulas.SetVolumeKg(we.Exercise.Modality, s.WeightKg, s.Reps, bodyWeightKg);
        }

        var duration = w.FinishedAt is { } f ? (int)(f - w.StartedAt).TotalSeconds : null as int?;
        return new WorkoutTotals(Math.Round(volume, 1), sets, reps, duration);
    }

    public static WorkoutSummaryDto ToSummary(this Workout w, decimal? bodyWeightKg)
    {
        var totals = Totals(w, bodyWeightKg);
        var groups = w.Exercises
            .Select(x => x.Exercise.MuscleGroup)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        return new WorkoutSummaryDto(
            w.Id, w.Name, w.StartedAt, w.FinishedAt, w.Routine?.Name,
            totals.VolumeKg, totals.Sets, w.Exercises.Count, totals.DurationSeconds, groups);
    }
}
