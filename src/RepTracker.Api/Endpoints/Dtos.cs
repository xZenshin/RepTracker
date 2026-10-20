using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

// ---- auth ----
public record RegisterRequest(string? DisplayName);
public record RegisterResponse(string LoginCode, string Formatted, UserDto User);
public record LoginRequest(string Code);
public record UserDto(
    Guid Id, string? DisplayName, string Units, decimal? BodyWeightKg, decimal? WeightStepKg, DateTimeOffset CreatedAt);
/// <summary>A WeightStepKg of 0 or less clears it back to the default for the user's units.</summary>
public record UpdateUserRequest(string? DisplayName, string? Units, decimal? BodyWeightKg, decimal? WeightStepKg);

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

/// <summary>Volume counts completed sets only; an unticked row was never done.</summary>
public record WorkoutTotals(decimal VolumeKg, int Sets, int Reps, int? DurationSeconds);

public record WorkoutExerciseDto(
    Guid Id, Guid ExerciseId, string ExerciseName, string MuscleGroup, string Equipment,
    Modality Modality, int Position, int RestSeconds, string? Notes,
    List<SetDto> Sets, PreviousPerformanceDto? Previous);

public record SetDto(
    Guid Id, int Position, decimal? WeightKg, int? Reps, int? DurationSeconds,
    decimal? DistanceM, decimal? Rpe, bool IsCompleted, DateTimeOffset? CompletedAt);

/// <summary>What this exercise looked like last time, so the phone can prefill "80 kg x 8".</summary>
public record PreviousPerformanceDto(DateTimeOffset PerformedAt, List<PreviousSetDto> Sets);
public record PreviousSetDto(decimal? WeightKg, int? Reps, int? DurationSeconds, decimal? DistanceM);

public record WorkoutSummaryDto(
    Guid Id, string Name, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt,
    string? RoutineName, decimal VolumeKg, int Sets, int Exercises, int? DurationSeconds,
    List<string> MuscleGroups);

public record UpdateWorkoutRequest(string? Name, string? Notes, bool? Finish);
public record AddWorkoutExerciseRequest(Guid ExerciseId);

/// <summary>The exercise to do instead, when the planned one's machine or bench is taken.</summary>
public record SwapWorkoutExerciseRequest(Guid ExerciseId);
public record UpdateWorkoutExerciseRequest(int? Position, int? RestSeconds, string? Notes);

public record CreateSetRequest(
    decimal? WeightKg, int? Reps, int? DurationSeconds, decimal? DistanceM,
    decimal? Rpe, bool? IsCompleted);

public record UpdateSetRequest(
    decimal? WeightKg, int? Reps, int? DurationSeconds, decimal? DistanceM,
    decimal? Rpe, bool? IsCompleted);

public record PagedResult<T>(List<T> Items, string? NextCursor);

// ---- import ----

/// <summary>
/// What an import did, or would do. <see cref="Workouts"/> and <see cref="Sets"/> count only what is
/// new; workouts already in the account are counted in <see cref="Duplicates"/> and skipped. Line 0
/// in an error means the file as a whole rather than one row of it. <see cref="EmptySets"/> counts
/// rows logged with 0 reps, skipped as sets never done; <see cref="WorkoutNames"/> how many new
/// workouts get each name.
/// </summary>
public record ImportSummaryDto(
    bool Committed, int Rows, int Workouts, int Sets, int EmptySets, DateOnly? From, DateOnly? To, int Duplicates,
    int MatchedExercises, List<ImportNewExerciseDto> NewExercises, List<ImportRenamedDto> Renamed,
    Dictionary<string, int> WorkoutNames, List<ImportCorrectedDateDto> CorrectedDates,
    List<ImportErrorDto> Errors, int ErrorCount);

public record ImportNewExerciseDto(string Name, string MuscleGroup, Modality Modality);

/// <summary>A name in the file that was matched to an exercise spelled differently, like "Squat" to "Back Squat".</summary>
public record ImportRenamedDto(string From, string To);

/// <summary>
/// A date moved back a year because the export wrote late December with the next year's number, a
/// week-numbering bug. Listed so the correction is seen rather than silent.
/// </summary>
public record ImportCorrectedDateDto(DateOnly Written, DateOnly Corrected);

public record ImportErrorDto(int Line, string Message);
