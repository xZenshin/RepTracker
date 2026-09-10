namespace RepTracker.Api.Data;

/// <summary>
/// The built-in exercise library. Shared by every account (UserId null) so that stats stay
/// comparable and nobody has to type "Barbell Bench Press" on a phone before their first set.
/// Rows are matched by name, so renaming an entry here creates a new exercise rather than
/// rewriting history - add and archive instead.
/// </summary>
public static class ExerciseCatalog
{
    public record Seed(string Name, string MuscleGroup, string Equipment, Modality Modality, string Pattern);

    private const Modality WR = Modality.WeightReps;
    private const Modality BW = Modality.BodyweightReps;
    private const Modality DU = Modality.Duration;
    private const Modality DD = Modality.DistanceDuration;

    public static readonly Seed[] All =
    [
        // Chest
        new("Barbell Bench Press", "Chest", "Barbell", WR, "push"),
        new("Incline Barbell Bench Press", "Chest", "Barbell", WR, "push"),
        new("Dumbbell Bench Press", "Chest", "Dumbbell", WR, "push"),
        new("Incline Dumbbell Press", "Chest", "Dumbbell", WR, "push"),
        new("Dumbbell Fly", "Chest", "Dumbbell", WR, "push"),
        new("Cable Crossover", "Chest", "Cable", WR, "push"),
        new("Chest Press Machine", "Chest", "Machine", WR, "push"),
        new("Pec Deck", "Chest", "Machine", WR, "push"),
        new("Push-Up", "Chest", "Bodyweight", BW, "push"),
        new("Dip", "Chest", "Bodyweight", BW, "push"),

        // Back
        new("Deadlift", "Back", "Barbell", WR, "pull"),
        new("Barbell Row", "Back", "Barbell", WR, "pull"),
        new("Pendlay Row", "Back", "Barbell", WR, "pull"),
        new("T-Bar Row", "Back", "Barbell", WR, "pull"),
        new("Dumbbell Row", "Back", "Dumbbell", WR, "pull"),
        new("Seated Cable Row", "Back", "Cable", WR, "pull"),
        new("Lat Pulldown", "Back", "Cable", WR, "pull"),
        new("Straight-Arm Pulldown", "Back", "Cable", WR, "pull"),
        new("Pull-Up", "Back", "Bodyweight", BW, "pull"),
        new("Chin-Up", "Back", "Bodyweight", BW, "pull"),
        new("Chest-Supported Row", "Back", "Machine", WR, "pull"),
        new("Face Pull", "Back", "Cable", WR, "pull"),
        new("Barbell Shrug", "Back", "Barbell", WR, "pull"),
        new("Back Extension", "Back", "Bodyweight", BW, "pull"),

        // Shoulders
        new("Overhead Press", "Shoulders", "Barbell", WR, "push"),
        new("Seated Dumbbell Shoulder Press", "Shoulders", "Dumbbell", WR, "push"),
        new("Arnold Press", "Shoulders", "Dumbbell", WR, "push"),
        new("Lateral Raise", "Shoulders", "Dumbbell", WR, "push"),
        new("Cable Lateral Raise", "Shoulders", "Cable", WR, "push"),
        new("Rear Delt Fly", "Shoulders", "Dumbbell", WR, "pull"),
        new("Upright Row", "Shoulders", "Barbell", WR, "pull"),
        new("Front Raise", "Shoulders", "Dumbbell", WR, "push"),

        // Biceps
        new("Barbell Curl", "Biceps", "Barbell", WR, "pull"),
        new("EZ-Bar Curl", "Biceps", "Barbell", WR, "pull"),
        new("Dumbbell Curl", "Biceps", "Dumbbell", WR, "pull"),
        new("Hammer Curl", "Biceps", "Dumbbell", WR, "pull"),
        new("Incline Dumbbell Curl", "Biceps", "Dumbbell", WR, "pull"),
        new("Preacher Curl", "Biceps", "Machine", WR, "pull"),
        new("Cable Curl", "Biceps", "Cable", WR, "pull"),

        // Triceps
        new("Close-Grip Bench Press", "Triceps", "Barbell", WR, "push"),
        new("Triceps Pushdown", "Triceps", "Cable", WR, "push"),
        new("Overhead Cable Extension", "Triceps", "Cable", WR, "push"),
        new("Skullcrusher", "Triceps", "Barbell", WR, "push"),
        new("Dumbbell Kickback", "Triceps", "Dumbbell", WR, "push"),
        new("Triceps Dip", "Triceps", "Bodyweight", BW, "push"),

        // Quads
        new("Back Squat", "Quads", "Barbell", WR, "legs"),
        new("Front Squat", "Quads", "Barbell", WR, "legs"),
        new("Hack Squat", "Quads", "Machine", WR, "legs"),
        new("Leg Press", "Quads", "Machine", WR, "legs"),
        new("Bulgarian Split Squat", "Quads", "Dumbbell", WR, "legs"),
        new("Walking Lunge", "Quads", "Dumbbell", WR, "legs"),
        new("Leg Extension", "Quads", "Machine", WR, "legs"),
        new("Goblet Squat", "Quads", "Dumbbell", WR, "legs"),

        // Hamstrings and glutes
        new("Romanian Deadlift", "Hamstrings", "Barbell", WR, "legs"),
        new("Stiff-Leg Deadlift", "Hamstrings", "Barbell", WR, "legs"),
        new("Lying Leg Curl", "Hamstrings", "Machine", WR, "legs"),
        new("Seated Leg Curl", "Hamstrings", "Machine", WR, "legs"),
        new("Nordic Curl", "Hamstrings", "Bodyweight", BW, "legs"),
        new("Hip Thrust", "Glutes", "Barbell", WR, "legs"),
        new("Glute Bridge", "Glutes", "Bodyweight", BW, "legs"),
        new("Cable Kickback", "Glutes", "Cable", WR, "legs"),
        new("Hip Abduction Machine", "Glutes", "Machine", WR, "legs"),

        // Calves
        new("Standing Calf Raise", "Calves", "Machine", WR, "legs"),
        new("Seated Calf Raise", "Calves", "Machine", WR, "legs"),

        // Core
        new("Plank", "Core", "Bodyweight", DU, "core"),
        new("Side Plank", "Core", "Bodyweight", DU, "core"),
        new("Hanging Leg Raise", "Core", "Bodyweight", BW, "core"),
        new("Cable Crunch", "Core", "Cable", WR, "core"),
        new("Ab Wheel Rollout", "Core", "Bodyweight", BW, "core"),
        new("Russian Twist", "Core", "Dumbbell", WR, "core"),
        new("Dead Bug", "Core", "Bodyweight", BW, "core"),

        // Forearms
        new("Wrist Curl", "Forearms", "Dumbbell", WR, "pull"),
        new("Farmer's Walk", "Forearms", "Dumbbell", DU, "pull"),

        // Conditioning
        new("Treadmill Run", "Cardio", "Machine", DD, "cardio"),
        new("Stationary Bike", "Cardio", "Machine", DD, "cardio"),
        new("Rowing Machine", "Cardio", "Machine", DD, "cardio"),
        new("Stair Climber", "Cardio", "Machine", DD, "cardio"),
        new("Incline Walk", "Cardio", "Machine", DD, "cardio"),
    ];

    /// <summary>Every muscle group the catalogue uses, in the order the dashboard should chart them.</summary>
    public static readonly string[] MuscleGroups =
    [
        "Chest", "Back", "Shoulders", "Biceps", "Triceps",
        "Quads", "Hamstrings", "Glutes", "Calves", "Core", "Forearms", "Cardio",
    ];
}
