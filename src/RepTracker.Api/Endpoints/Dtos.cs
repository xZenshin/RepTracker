using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

// ---- auth ----
public record RegisterRequest(string? DisplayName, string? SignupCode);
public record RegisterResponse(string LoginCode, string Formatted, UserDto User);
public record LoginRequest(string Code);
public record UserDto(Guid Id, string? DisplayName, string Units, decimal? BodyWeightKg, DateTimeOffset CreatedAt);
public record UpdateUserRequest(string? DisplayName, string? Units, decimal? BodyWeightKg);

// ---- exercises ----
public record ExerciseDto(
    Guid Id, string Name, string MuscleGroup, string Equipment,
    Modality Modality, string Pattern, bool IsCustom, bool IsArchived);

public record CreateExerciseRequest(string Name, string MuscleGroup, string Equipment, Modality Modality, string Pattern);
public record UpdateExerciseRequest(string? Name, string? MuscleGroup, string? Equipment, string? Pattern, bool? IsArchived);

// ---- routines ----
public record RoutineDto(
    Guid Id, string Name, string? Notes, bool IsArchived,
    DateTimeOffset UpdatedAt, List<RoutineExerciseDto> Exercises);

public record RoutineExerciseDto(
    Guid Id, Guid ExerciseId, string ExerciseName, string MuscleGroup, Modality Modality,
    int Position, int TargetSets, int? TargetRepsMin, int? TargetRepsMax,
    decimal? TargetWeightKg, int RestSeconds, string? Notes);

public record SaveRoutineRequest(string Name, string? Notes, List<SaveRoutineExercise> Exercises);
public record SaveRoutineExercise(
    Guid ExerciseId, int TargetSets, int? TargetRepsMin, int? TargetRepsMax,
    decimal? TargetWeightKg, int RestSeconds, string? Notes);

// ---- workouts ----
public record StartWorkoutRequest(Guid? RoutineId, string? Name);

public record WorkoutDto(
    Guid Id, string Name, string? Notes, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt,
    Guid? RoutineId, string? RoutineName, WorkoutTotals Totals, List<WorkoutExerciseDto> Exercises);

/// <summary>Volume counts completed working sets only; warm-ups are excluded everywhere.</summary>
public record WorkoutTotals(decimal VolumeKg, int Sets, int Reps, int? DurationSeconds);

public record WorkoutExerciseDto(
    Guid Id, Guid ExerciseId, string ExerciseName, string MuscleGroup, string Equipment,
    Modality Modality, int Position, int RestSeconds, string? Notes,
    List<SetDto> Sets, PreviousPerformanceDto? Previous);

public record SetDto(
    Guid Id, int Position, decimal? WeightKg, int? Reps, int? DurationSeconds,
    decimal? DistanceM, decimal? Rpe, bool IsWarmup, bool IsCompleted, DateTimeOffset? CompletedAt);

/// <summary>What this exercise looked like last time, so the phone can prefill "80 kg x 8".</summary>
public record PreviousPerformanceDto(DateTimeOffset PerformedAt, List<PreviousSetDto> Sets);
public record PreviousSetDto(decimal? WeightKg, int? Reps, int? DurationSeconds, decimal? DistanceM, bool IsWarmup);

public record WorkoutSummaryDto(
    Guid Id, string Name, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt,
    string? RoutineName, decimal VolumeKg, int Sets, int Exercises, int? DurationSeconds,
    List<string> MuscleGroups);

public record UpdateWorkoutRequest(string? Name, string? Notes, bool? Finish);
public record AddWorkoutExerciseRequest(Guid ExerciseId);
public record UpdateWorkoutExerciseRequest(int? Position, int? RestSeconds, string? Notes);

public record CreateSetRequest(
    decimal? WeightKg, int? Reps, int? DurationSeconds, decimal? DistanceM,
    decimal? Rpe, bool? IsWarmup, bool? IsCompleted);

public record UpdateSetRequest(
    decimal? WeightKg, int? Reps, int? DurationSeconds, decimal? DistanceM,
    decimal? Rpe, bool? IsWarmup, bool? IsCompleted);

public record PagedResult<T>(List<T> Items, string? NextCursor);
