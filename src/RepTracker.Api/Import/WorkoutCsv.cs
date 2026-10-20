using System.Globalization;
using RepTracker.Api.Config;
using RepTracker.Api.Data;

namespace RepTracker.Api.Import;

/// <summary>
/// Turns a spreadsheet of sets - one row per set - into workouts. Pure: no database, no clock of
/// its own, so it can be exercised directly.
///
/// Rows sharing a date (and time, if given) and a workout name are one workout. Exercises and sets
/// keep the order the rows are in. Every imported set is a completed set.
/// </summary>
public static class WorkoutCsv
{
    public const int MaxRows = 20_000;

    /// <summary>The header of the downloadable template, in the order it lists the columns.</summary>
    public static readonly string[] TemplateColumns =
        ["date", "workout", "exercise", "weight", "reps", "duration", "warmup", "muscle group", "workout minutes"];

    // Spreadsheet headers drift - "Exercise Name", "warm-up", "Workout_Minutes" - so each column
    // answers to a few spellings, compared after lower-casing and folding _ and - into spaces.
    private static readonly Dictionary<string, string> Aliases = new()
    {
        ["date"] = "date", ["day"] = "date", ["date and time"] = "date", ["start"] = "date",
        ["workout"] = "workout", ["workout name"] = "workout", ["session"] = "workout", ["routine"] = "workout",
        ["exercise"] = "exercise", ["exercise name"] = "exercise", ["lift"] = "exercise", ["movement"] = "exercise",
        ["weight"] = "weight", ["load"] = "weight",
        ["reps"] = "reps", ["repetitions"] = "reps",
        ["duration"] = "duration", ["seconds"] = "duration", ["hold"] = "duration",
        ["warmup"] = "warmup", ["warm up"] = "warmup",
        ["muscle group"] = "muscle group", ["muscle"] = "muscle group",
        ["workout minutes"] = "workout minutes", ["minutes"] = "workout minutes", ["workout length"] = "workout minutes",
    };

    private static readonly string[] DateFormats = BuildDateFormats();

    public sealed record Set(int Line, decimal? WeightKg, int? Reps, int? DurationSeconds, bool IsWarmup);

    public sealed class Exercise(string name)
    {
        public string Name { get; } = name;
        public List<Set> Sets { get; } = [];
    }

    public sealed class Workout(string name, DateTimeOffset startedAt, int line)
    {
        public string Name { get; } = name;
        public DateTimeOffset StartedAt { get; set; } = startedAt;
        public int Line { get; } = line;
        public int? Minutes { get; set; }
        public List<Exercise> Exercises { get; } = [];
    }

    public sealed record Error(int Line, string Message);

    /// <summary>What the file asks for a new exercise to be, gathered across all its rows.</summary>
    public sealed record ExerciseHints(string? MuscleGroup, bool HasWeight, bool HasReps);

    public sealed record Result(
        List<Workout> Workouts, Dictionary<string, ExerciseHints> Hints, List<Error> Errors, int Rows);

    public static Result Parse(
        string text, string units, TimeZoneInfo zone, DateTimeOffset now, AppOptions.PerUserLimits limits)
    {
        var errors = new List<Error>();
        var workouts = new List<Workout>();
        var hints = new Dictionary<string, ExerciseHints>();

        var rows = Csv.Read(text, Csv.DetectDelimiter(text));

        // "sep=," is Excel's own hint for which separator to split on - the template starts with it so
        // a European Excel opens it in columns. The separator itself has already been detected from it.
        if (rows.Count > 0 && rows[0].Fields[0].TrimStart().StartsWith("sep=", StringComparison.OrdinalIgnoreCase))
            rows.RemoveAt(0);

        if (rows.Count == 0) return new([], hints, [new(1, "The file is empty.")], 0);

        // ---- header ----

        var header = rows[0];
        var columns = new Dictionary<string, int>();
        for (var i = 0; i < header.Fields.Length; i++)
        {
            var key = NormalizeHeader(header.Fields[i]);
            if (Aliases.TryGetValue(key, out var column) && !columns.ContainsKey(column)) columns[column] = i;
        }

        var missing = new[] { "date", "exercise" }.Where(c => !columns.ContainsKey(c)).ToList();
        if (missing.Count > 0)
        {
            var found = string.Join(", ", header.Fields.Select(f => $"\"{f.Trim()}\""));
            return new([], hints, [new(header.Line,
                $"The first row needs a {string.Join(" and a ", missing)} column. It has: {found}.")], 0);
        }

        if (rows.Count - 1 > MaxRows)
            return new([], hints, [new(header.Line, $"The file has {rows.Count - 1:N0} rows; the limit is {MaxRows:N0}.")], rows.Count - 1);

        string Cell(Csv.Row row, string column) =>
            columns.TryGetValue(column, out var index) && index < row.Fields.Length ? row.Fields[index].Trim() : "";

        // ---- rows ----

        var byKey = new Dictionary<(DateTime Local, bool HasTime, string Name), Workout>();
        var untimedPerDay = new Dictionary<DateOnly, int>();
        var earliest = new DateTimeOffset(1970, 1, 1, 0, 0, 0, TimeSpan.Zero);

        foreach (var row in rows.Skip(1))
        {
            void Fail(string message) => errors.Add(new(row.Line, message));

            // -- when --
            var dateText = Cell(row, "date");
            if (dateText.Length == 0) { Fail("The date is empty."); continue; }
            if (!TryParseDate(dateText, out var local, out var hasTime, out var fixedOffset))
            {
                Fail($"\"{dateText}\" is not a date this can read. Use 2026-08-14 or 14.08.2026, with a time after it if you like.");
                continue;
            }

            // -- what --
            var exerciseName = Cell(row, "exercise");
            if (exerciseName.Length == 0) { Fail("The exercise is empty."); continue; }
            if (exerciseName.Length > 80) { Fail("The exercise name is longer than 80 characters."); continue; }

            var workoutName = Cell(row, "workout");
            if (workoutName.Length == 0) workoutName = "Imported workout";
            if (workoutName.Length > 60) { Fail("The workout name is longer than 60 characters."); continue; }

            // -- the set itself --
            decimal? weightKg = null;
            var weightText = Cell(row, "weight");
            if (weightText.Length > 0)
            {
                if (!TryParseWeight(weightText, units, out var kg)) { Fail($"\"{weightText}\" is not a weight."); continue; }
                if (kg is < 0 or > 1000) { Fail($"{weightText} is outside 0-1000 kg."); continue; }
                weightKg = Math.Round(kg, 2);
            }

            int? reps = null;
            var repsText = Cell(row, "reps");
            if (repsText.Length > 0)
            {
                if (!TryParseWhole(repsText, out var r) || r is < 0 or > 1000) { Fail($"\"{repsText}\" is not a number of reps."); continue; }
                reps = r;
            }

            int? duration = null;
            var durationText = Cell(row, "duration");
            if (durationText.Length > 0)
            {
                if (!TryParseDuration(durationText, out var seconds)) { Fail($"\"{durationText}\" is not a duration. Use seconds, or 1:30."); continue; }
                duration = seconds;
            }

            if (reps is null && duration is null) { Fail("A set needs reps or a duration."); continue; }

            var warmupText = Cell(row, "warmup");
            if (!TryParseFlag(warmupText, out var isWarmup)) { Fail($"\"{warmupText}\" in the warm-up column should be yes, or empty."); continue; }

            int? minutes = null;
            var minutesText = Cell(row, "workout minutes");
            if (minutesText.Length > 0)
            {
                if (!TryParseWhole(minutesText, out var m) || m is < 1 or > 600) { Fail($"\"{minutesText}\" is not a workout length in minutes."); continue; }
                minutes = m;
            }

            var muscleText = Cell(row, "muscle group");
            string? muscleGroup = null;
            if (muscleText.Length > 0)
            {
                muscleGroup = ExerciseCatalog.MuscleGroups.FirstOrDefault(g => g.Equals(muscleText, StringComparison.OrdinalIgnoreCase));
                if (muscleGroup is null)
                {
                    Fail($"\"{muscleText}\" is not a muscle group. Use one of: {string.Join(", ", ExerciseCatalog.MuscleGroups)}.");
                    continue;
                }
            }

            // -- into a workout --
            var key = (local, hasTime, workoutName.ToLowerInvariant());
            if (!byKey.TryGetValue(key, out var workout))
            {
                var at = local;
                if (!hasTime)
                {
                    // Untimed workouts start at noon, a minute apart in file order, so two on one day
                    // keep their order and stay distinct.
                    var day = DateOnly.FromDateTime(local);
                    var nth = untimedPerDay.GetValueOrDefault(day);
                    untimedPerDay[day] = nth + 1;
                    at = local.Date.AddHours(12).AddMinutes(nth);
                }

                var startedAt = fixedOffset is { } offset
                    ? new DateTimeOffset(at, offset).ToUniversalTime()
                    : ToUtc(at, zone);

                if (startedAt > now.AddDays(1)) { Fail($"{dateText} is in the future."); continue; }
                if (startedAt < earliest) { Fail($"{dateText} is before 1970."); continue; }

                workout = new Workout(workoutName, startedAt, row.Line);
                byKey[key] = workout;
                workouts.Add(workout);
            }

            if (minutes is not null) workout.Minutes ??= minutes;

            var exercise = workout.Exercises.FirstOrDefault(e => e.Name.Equals(exerciseName, StringComparison.OrdinalIgnoreCase));
            if (exercise is null)
            {
                if (workout.Exercises.Count >= limits.ExercisesPerWorkout)
                {
                    Fail($"\"{workout.Name}\" has more than {limits.ExercisesPerWorkout} exercises.");
                    continue;
                }
                exercise = new Exercise(exerciseName);
                workout.Exercises.Add(exercise);
            }

            if (exercise.Sets.Count >= limits.SetsPerExercise)
            {
                Fail($"More than {limits.SetsPerExercise} sets of {exercise.Name} in one workout.");
                continue;
            }

            exercise.Sets.Add(new Set(row.Line, weightKg, reps, duration, isWarmup));

            var normalized = exerciseName.ToLowerInvariant();
            var hint = hints.GetValueOrDefault(normalized) ?? new ExerciseHints(null, false, false);
            hints[normalized] = new ExerciseHints(
                hint.MuscleGroup ?? muscleGroup,
                hint.HasWeight || weightKg > 0,
                hint.HasReps || reps is not null);
        }

        return new(workouts, hints, errors, rows.Count - 1);
    }

    /// <summary>
    /// A name reduced to letters and digits, so "Pull-ups", "pull ups" and "Pull-Up" can be compared.
    /// </summary>
    public static string LooseKey(string name) =>
        new([.. name.ToLowerInvariant().Where(char.IsLetterOrDigit)]);

    /// <summary>
    /// The short names a hand-kept log uses for catalogue lifts, by loose key. Only the unambiguous
    /// ones: "curl" or "shoulder press" could be several exercises, so those stay unmatched and show up
    /// in the preview as new.
    /// </summary>
    private static readonly Dictionary<string, string> Shorthand = new()
    {
        ["bench"] = "Barbell Bench Press",
        ["benchpress"] = "Barbell Bench Press",
        ["flatbench"] = "Barbell Bench Press",
        ["inclinebench"] = "Incline Barbell Bench Press",
        ["squat"] = "Back Squat",
        ["ohp"] = "Overhead Press",
        ["militarypress"] = "Overhead Press",
        ["row"] = "Barbell Row",
        ["bentoverrow"] = "Barbell Row",
        ["rdl"] = "Romanian Deadlift",
        ["sldl"] = "Stiff-Leg Deadlift",
        ["pulldown"] = "Lat Pulldown",
        ["lunge"] = "Walking Lunge",
        ["calfraise"] = "Standing Calf Raise",
    };

    /// <summary>
    /// The exercise a name in the file means: the exact name, then the same letters ignoring spaces,
    /// hyphens and a plural s, then a known short name. Null when it is genuinely new.
    /// </summary>
    public static T? Match<T>(string name, IReadOnlyDictionary<string, T> byLooseKey) where T : class
    {
        var key = LooseKey(name);
        var singular = key.EndsWith('s') ? key[..^1] : key;

        foreach (var candidate in new[] { key, singular })
        {
            if (byLooseKey.TryGetValue(candidate, out var found)) return found;
            if (Shorthand.TryGetValue(candidate, out var full) && byLooseKey.TryGetValue(LooseKey(full), out found)) return found;
        }

        return null;
    }

    /// <summary>A new exercise's kind, from what its rows recorded: load, bare reps, or time.</summary>
    public static Modality InferModality(ExerciseHints hints) =>
        hints.HasWeight ? Modality.WeightReps
        : hints.HasReps ? Modality.BodyweightReps
        : Modality.Duration;

    // ---- cells ----

    private static string NormalizeHeader(string value) =>
        string.Join(' ', value.Trim().ToLowerInvariant().Replace('_', ' ').Replace('-', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static string[] BuildDateFormats()
    {
        string[] days = ["yyyy-MM-dd", "yyyy-M-d", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d.M.yyyy"];
        string[] times = ["", " HH:mm", " H:mm", " HH:mm:ss", " H:mm:ss", "'T'HH:mm", "'T'HH:mm:ss"];
        return [.. days.SelectMany(d => times.Select(t => d + t))];
    }

    /// <summary>
    /// ISO dates, or day-first with dots or dashes as a European spreadsheet writes them. Slashes are
    /// refused: 03/04/2026 is March in one country and April in the next.
    /// </summary>
    private static bool TryParseDate(string text, out DateTime local, out bool hasTime, out TimeSpan? offset)
    {
        offset = null;
        hasTime = false;

        if (DateTime.TryParseExact(text, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out local))
        {
            hasTime = local.TimeOfDay != TimeSpan.Zero || text.Contains(':');
            return true;
        }

        // A full timestamp with its own zone, as other software exports it, keeps that zone.
        if (text.Contains('T') && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var stamped)
            && (text.EndsWith('Z') || text.LastIndexOfAny(['+', '-']) > text.IndexOf('T')))
        {
            local = stamped.DateTime;
            offset = stamped.Offset;
            hasTime = true;
            return true;
        }

        return false;
    }

    /// <summary>"102.5", "102,5", or with its own unit: "225 lb", "100kg".</summary>
    private static bool TryParseWeight(string text, string units, out decimal kg)
    {
        kg = 0;
        var value = text.Trim().ToLowerInvariant();
        var unit = units;

        foreach (var (suffix, meaning) in new[] { ("lbs", "lb"), ("lb", "lb"), ("kg", "kg") })
        {
            if (!value.EndsWith(suffix)) continue;
            unit = meaning;
            value = value[..^suffix.Length].Trim();
            break;
        }

        if (!TryParseNumber(value, out var number)) return false;
        kg = unit == "lb" ? number / 2.20462262m : number;
        return true;
    }

    private static bool TryParseNumber(string text, out decimal value)
    {
        var normalized = text.Replace(" ", "");
        // A lone comma is a decimal comma; with a point present it is a thousands separator.
        normalized = normalized.Contains('.') ? normalized.Replace(",", "") : normalized.Replace(',', '.');
        return decimal.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static bool TryParseWhole(string text, out int value)
    {
        value = 0;
        if (!TryParseNumber(text, out var number) || number != decimal.Truncate(number) || number > int.MaxValue) return false;
        value = (int)number;
        return true;
    }

    /// <summary>Seconds, or m:ss, or h:mm:ss.</summary>
    private static bool TryParseDuration(string text, out int seconds)
    {
        seconds = 0;
        var parts = text.Split(':');
        if (parts.Length > 3 || parts.Any(p => !int.TryParse(p, NumberStyles.None, CultureInfo.InvariantCulture, out _))) return false;

        var total = parts.Select(int.Parse).Aggregate(0L, (acc, part) => acc * 60 + part);
        if (total is < 1 or > 86_400) return false;
        seconds = (int)total;
        return true;
    }

    private static bool TryParseFlag(string text, out bool value)
    {
        var v = text.Trim().ToLowerInvariant();
        value = v is "yes" or "y" or "true" or "1" or "x" or "w" or "warmup" or "warm-up";
        return value || v is "" or "no" or "n" or "false" or "0";
    }

    /// <summary>
    /// A wall-clock time in the user's own zone, to UTC. Uses that date's own offset rather than
    /// today's, so a summer workout imported in winter still lands on the right hour - and day.
    /// </summary>
    private static DateTimeOffset ToUtc(DateTime local, TimeZoneInfo zone)
    {
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        // The hour skipped when the clocks go forward does not exist; the hour after it does.
        if (zone.IsInvalidTime(local)) local = local.AddHours(1);
        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }
}
