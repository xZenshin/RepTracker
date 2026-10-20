namespace RepTracker.Api.Import;

/// <summary>
/// What an exercise the app has never seen probably is, read from its name: its muscle group, its
/// push/pull pattern and its equipment. Imported logs carry only a name, and an exercise filed under
/// "Other" drops out of the muscle-group and balance charts, so a careful guess beats none. The
/// preview lists every guess before anything is written.
///
/// Rules are tried in order and the first match wins, so the specific ones come first: a leg curl is
/// a hamstring exercise before it is a curl, an upright row is shoulders before it is a row. Words
/// are matched at their start, so "row" never fires inside "narrow".
/// </summary>
public static class ExerciseGuess
{
    public sealed record Guess(string MuscleGroup, string Pattern, string Equipment);

    private static readonly (string[] Words, string MuscleGroup, string Pattern)[] Rules =
    [
        (["leg curl", "hamstring", "romanian", "rdl", "good morning", "nordic"], "Hamstrings", "legs"),
        (["rear delt", "reverse fly", "reverse pec", "upright row"], "Shoulders", "pull"),
        (["face pull", "shrug", "back extension", "hyperextension"], "Back", "pull"),
        (["row", "pulldown", "pull down", "pull up", "pullup", "chin up", "chinup", "lat ", "pullover"], "Back", "pull"),
        (["tricep", "pushdown", "push down", "skull", "jm press", "kickback"], "Triceps", "push"),
        (["forearm", "wrist"], "Forearms", "pull"),
        (["curl"], "Biceps", "pull"),
        (["lateral raise", "side raise", "front raise", "shoulder", "delt", "overhead press", "military", "arnold"], "Shoulders", "push"),
        (["chest", "bench", "fly", "flye", "pec", "dip", "push up", "pushup", "press up"], "Chest", "push"),
        (["leg extension", "squat", "leg press", "lunge", "quad", "step up"], "Quads", "legs"),
        (["calf", "calves"], "Calves", "legs"),
        (["glute", "hip thrust", "abduction", "adduction"], "Glutes", "legs"),
        (["crunch", "leg raise", "knee raise", "wood chop", "woodchop", "plank", "ab ", "abs", "core", "twist", "rollout", "sit up"], "Core", "core"),
    ];

    private static readonly (string[] Words, string Equipment)[] EquipmentRules =
    [
        (["cable", "rope"], "Cable"),
        (["dumbbell", "db "], "Dumbbell"),
        (["barbell", "ez bar", "bb "], "Barbell"),
        (["smith", "machine", "leverage", "pec deck", "hack"], "Machine"),
        (["kettlebell"], "Kettlebell"),
        (["band"], "Band"),
        (["pull up", "pullup", "chin up", "chinup", "dip", "push up", "pushup", "plank"], "Bodyweight"),
    ];

    public static Guess For(string name)
    {
        // Lower-cased, punctuation to spaces, padded: " dips chest version ". A rule word is looked
        // for with a space in front, so it only matches where a word begins.
        var words = " " + string.Join(' ', new string([.. name.ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : ' ')])
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)) + " ";

        bool Has(string word) => words.Contains(" " + word, StringComparison.Ordinal);

        var rule = Rules.FirstOrDefault(r => r.Words.Any(Has));
        var equipment = EquipmentRules.FirstOrDefault(r => r.Words.Any(Has)).Equipment ?? "Other";

        return rule.Words is null
            ? new Guess("Other", "other", equipment)
            : new Guess(rule.MuscleGroup, rule.Pattern, equipment);
    }

    /// <summary>
    /// A name for a workout from what was trained in it, counted in sets: "Push", "Pull" or "Legs"
    /// when one kind makes up most of it, "Upper body" or "Full body" when it is mixed.
    /// </summary>
    public static string WorkoutName(IReadOnlyDictionary<string, int> setsByPattern)
    {
        string[] kinds = ["push", "pull", "legs", "core"];
        var counted = kinds.ToDictionary(k => k, k => setsByPattern.GetValueOrDefault(k));
        var total = counted.Values.Sum();
        if (total == 0) return "Workout";

        var (top, sets) = counted.MaxBy(kv => kv.Value);
        if (sets >= total * 0.6)
        {
            return top switch
            {
                "push" => "Push",
                "pull" => "Pull",
                "legs" => "Legs",
                _ => "Core",
            };
        }

        return counted["legs"] < total * 0.2 ? "Upper body" : "Full body";
    }
}
