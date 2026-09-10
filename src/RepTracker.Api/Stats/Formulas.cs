using RepTracker.Api.Data;

namespace RepTracker.Api.Stats;

public static class Formulas
{
    /// <summary>
    /// Above roughly a dozen reps a set is limited by endurance rather than strength, and every
    /// 1RM formula drifts badly. Sets beyond this are logged and counted as volume, but never
    /// treated as strength data points.
    /// </summary>
    public const int MaxRepsForOneRepMax = 12;

    /// <summary>
    /// The load actually moved. Bodyweight movements count the athlete's own mass, otherwise a set
    /// of unweighted pull-ups registers as zero volume and progress on them is invisible.
    /// </summary>
    public static decimal EffectiveLoadKg(Modality modality, decimal? weightKg, decimal? bodyWeightKg) =>
        modality switch
        {
            Modality.WeightReps => weightKg ?? 0m,
            Modality.BodyweightReps => (bodyWeightKg ?? 0m) + (weightKg ?? 0m),
            _ => 0m,
        };

    /// <summary>
    /// Estimated one-rep max, Epley. Returns null where an estimate would be misleading: no reps,
    /// no load, or a rep count high enough that the formula stops tracking reality.
    /// </summary>
    public static decimal? EstimatedOneRepMax(decimal loadKg, int? reps)
    {
        if (reps is not > 0 || loadKg <= 0m) return null;
        if (reps > MaxRepsForOneRepMax) return null;
        if (reps == 1) return loadKg;
        return Math.Round(loadKg * (1m + reps.Value / 30m), 2);
    }

    /// <summary>Volume load for a single set: what was lifted, times how many times.</summary>
    public static decimal SetVolumeKg(Modality modality, decimal? weightKg, int? reps, decimal? bodyWeightKg) =>
        EffectiveLoadKg(modality, weightKg, bodyWeightKg) * (reps ?? 0);

    /// <summary>
    /// A "hard set" for weekly-volume purposes: a completed working set that actually loaded the
    /// muscle. Warm-ups and conditioning work do not count toward a hypertrophy set target.
    /// </summary>
    public static bool IsHardSet(WorkoutSet set, Modality modality) =>
        set.IsCompleted
        && !set.IsWarmup
        && modality is Modality.WeightReps or Modality.BodyweightReps
        && set.Reps is > 0;
}
