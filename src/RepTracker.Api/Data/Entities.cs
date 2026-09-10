using System.ComponentModel.DataAnnotations;

namespace RepTracker.Api.Data;

/// <summary>How a set for a given exercise is measured. Drives both the logging UI and which stats apply.</summary>
public enum Modality
{
    /// <summary>External load and reps: bench press, squat.</summary>
    WeightReps = 0,
    /// <summary>Reps against bodyweight, optional added load: pull-ups, dips.</summary>
    BodyweightReps = 1,
    /// <summary>Held for time: plank, dead hang.</summary>
    Duration = 2,
    /// <summary>Distance over time: running, rowing.</summary>
    DistanceDuration = 3,
}

public class User
{
    public Guid Id { get; set; }

    /// <summary>HMAC-SHA256 of the login code under the server pepper. Indexed for single-lookup login.</summary>
    public byte[] LoginCodeHmac { get; set; } = [];

    [MaxLength(40)] public string? DisplayName { get; set; }
    [MaxLength(2)] public string Units { get; set; } = "kg";

    /// <summary>Used to give bodyweight movements a real load in volume and e1RM maths.</summary>
    public decimal? BodyWeightKg { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }

    public List<Session> Sessions { get; set; } = [];
    public List<Exercise> Exercises { get; set; } = [];
    public List<Routine> Routines { get; set; } = [];
    public List<Workout> Workouts { get; set; } = [];
}

public class Session
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>SHA-256 of the opaque cookie token. The raw token is never stored.</summary>
    public byte[] TokenHash { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
}

public class Exercise
{
    public Guid Id { get; set; }

    /// <summary>Null for the seeded global catalogue; set for a user's own exercises.</summary>
    public Guid? UserId { get; set; }
    public User? User { get; set; }

    [MaxLength(80)] public string Name { get; set; } = "";

    /// <summary>Lower-cased <see cref="Name"/>, kept in sync on write so uniqueness is case-insensitive.</summary>
    [MaxLength(80)] public string NameNormalized { get; set; } = "";

    [MaxLength(40)] public string MuscleGroup { get; set; } = "Other";
    [MaxLength(40)] public string Equipment { get; set; } = "Other";
    public Modality Modality { get; set; } = Modality.WeightReps;

    /// <summary>Push/pull/legs/core. Powers the balance ratios on the dashboard.</summary>
    [MaxLength(20)] public string Pattern { get; set; } = "other";

    public bool IsArchived { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class Routine
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(500)] public string? Notes { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<RoutineExercise> Exercises { get; set; } = [];
}

public class RoutineExercise
{
    public Guid Id { get; set; }
    public Guid RoutineId { get; set; }
    public Routine Routine { get; set; } = null!;
    public Guid ExerciseId { get; set; }
    public Exercise Exercise { get; set; } = null!;

    public int Position { get; set; }
    public int TargetSets { get; set; } = 3;
    public int? TargetRepsMin { get; set; }
    public int? TargetRepsMax { get; set; }
    public decimal? TargetWeightKg { get; set; }
    public int RestSeconds { get; set; } = 120;
    [MaxLength(200)] public string? Notes { get; set; }
}

public class Workout
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>The routine this was started from, if any. Kept for "how did last Push A go".</summary>
    public Guid? RoutineId { get; set; }
    public Routine? Routine { get; set; }

    [MaxLength(60)] public string Name { get; set; } = "Workout";
    [MaxLength(1000)] public string? Notes { get; set; }
    public DateTimeOffset StartedAt { get; set; }

    /// <summary>Null while the workout is still in progress. At most one unfinished workout per user.</summary>
    public DateTimeOffset? FinishedAt { get; set; }

    public List<WorkoutExercise> Exercises { get; set; } = [];
}

public class WorkoutExercise
{
    public Guid Id { get; set; }
    public Guid WorkoutId { get; set; }
    public Workout Workout { get; set; } = null!;
    public Guid ExerciseId { get; set; }
    public Exercise Exercise { get; set; } = null!;

    public int Position { get; set; }
    public int RestSeconds { get; set; } = 120;
    [MaxLength(200)] public string? Notes { get; set; }

    public List<WorkoutSet> Sets { get; set; } = [];
}

public class WorkoutSet
{
    public Guid Id { get; set; }
    public Guid WorkoutExerciseId { get; set; }
    public WorkoutExercise WorkoutExercise { get; set; } = null!;

    public int Position { get; set; }

    /// <summary>External load only, always kg. For bodyweight moves this is *added* load.</summary>
    public decimal? WeightKg { get; set; }
    public int? Reps { get; set; }
    public int? DurationSeconds { get; set; }
    public decimal? DistanceM { get; set; }

    /// <summary>Rate of perceived exertion, 5.0-10.0 in half steps.</summary>
    public decimal? Rpe { get; set; }

    /// <summary>Warm-ups are excluded from volume, hard-set counts and PRs.</summary>
    public bool IsWarmup { get; set; }

    public bool IsCompleted { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
