using RepTracker.Api.Data;

namespace RepTracker.Api.Stats;

public record OverviewDto(
    PeriodTotals Totals,
    ConsistencyDto Consistency,
    VolumeSeriesDto Volume,
    List<MuscleGroupLoadDto> MuscleGroups,
    BalanceDto Balance);

public record PeriodTotals(
    int Workouts, decimal VolumeKg, int Sets, int Reps, int DurationSeconds, decimal AvgWorkoutsPerWeek);

/// <summary>
/// Streaks are counted in weeks rather than days, because training every single day is not the goal
/// and a day-based streak would punish a correctly programmed rest day.
/// </summary>
public record ConsistencyDto(
    int CurrentWeekStreak, int LongestWeekStreak, int WorkoutsThisWeek, int ActiveWeeks, int TotalWorkouts);

/// <summary>
/// Volume over the period, one point per <see cref="Bucket"/> ("day" or "week"). The rolling average
/// spans the last <see cref="RollingPoints"/> points: a week of days, or a month of weeks.
/// </summary>
public record VolumeSeriesDto(string Bucket, int RollingPoints, List<VolumePointDto> Points);

public record VolumePointDto(
    DateOnly Start, int Workouts, decimal VolumeKg, int Sets, int DurationSeconds, decimal VolumeRolling);

/// <summary>
/// Hard sets per week is the number most closely tied to hypertrophy, which is why it is reported
/// alongside volume: 20 tonnes of lateral raises and 20 tonnes of squats are not the same stimulus.
/// </summary>
public record MuscleGroupLoadDto(
    string MuscleGroup, int Sets, decimal VolumeKg, decimal SetsPerWeek, string Verdict);

public record BalanceDto(
    int PushSets, int PullSets, int LegSets, int CoreSets, int CardioSets,
    decimal? PushPullRatio, decimal? UpperLowerRatio);

/// <summary>A moment an exercise's best estimated 1RM was beaten, from replaying its history.</summary>
public record RecordDto(
    Guid ExerciseId, string ExerciseName, DateTimeOffset AchievedAt,
    decimal EstimatedOneRepMax, decimal WeightKg, int Reps, decimal? PreviousBest);

public record CalendarDayDto(DateOnly Date, int Workouts, decimal VolumeKg, int Sets);

// ---- per-exercise ----

/// <summary>
/// One row of the exercise list. <see cref="Status"/> is "record" when the best estimated 1RM beat
/// an earlier best within the last month, "stalled" when it has not moved in six weeks of continued
/// training, and null otherwise.
/// </summary>
public record ExerciseListItemDto(
    Guid Id, string Name, string MuscleGroup, Modality Modality,
    int Sessions, DateTimeOffset? LastPerformedAt,
    decimal? BestOneRepMax, DateTimeOffset? BestOneRepMaxAt, decimal? BestWeightKg,
    string? Status);

public record ExerciseStatsDto(
    Guid ExerciseId, string ExerciseName, string MuscleGroup, Modality Modality,
    List<ExerciseSessionPointDto> Sessions,
    ExerciseRecordsDto Records,
    TrendDto Trend);

public record ExerciseSessionPointDto(
    Guid WorkoutId, DateOnly Date, decimal? EstimatedOneRepMax, decimal? TopSetWeightKg,
    int? TopSetReps, decimal VolumeKg, int Sets, int Reps, bool IsRecord);

public record ExerciseRecordsDto(
    decimal? BestOneRepMax, DateTimeOffset? BestOneRepMaxAt,
    decimal? BestWeightKg, int? BestWeightReps, DateTimeOffset? BestWeightAt,
    decimal? BestSessionVolumeKg, DateTimeOffset? BestSessionVolumeAt,
    List<RepRecordDto> BestRepsByWeight);

/// <summary>The most reps ever managed at a given load: the rep PR table lifters actually chase.</summary>
public record RepRecordDto(decimal WeightKg, int Reps, DateOnly AchievedAt);

/// <summary>
/// Direction of travel for estimated 1RM, comparing the recent half of the window with the earlier
/// half. Reported as null when there is not enough data for the comparison to mean anything.
/// </summary>
public record TrendDto(decimal? ChangePercent, decimal? RecentAvg, decimal? EarlierAvg, string Direction);
