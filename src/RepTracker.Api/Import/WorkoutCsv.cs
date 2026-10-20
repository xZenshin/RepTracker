using System.Globalization;
using RepTracker.Api.Config;

namespace RepTracker.Api.Import;

/// <summary>
/// Turns a workout log exported as CSV - one row per set - into workouts. Pure: no database, no
/// clock of its own, so it can be exercised directly.
///
/// The format is the one common logging apps export:
/// <c>Date,Exercise,Set #,Reps,Weight,Duration,Distance,Resistance,Notes</c>. Every set on one date
/// is one workout (two workouts on a day need a time in the date). Exercises and sets keep the order
/// the rows are in, so Set # is not needed. A set logged with 0 reps and no duration is a placeholder
/// that was never done, and is skipped. Distance and Resistance are read past.
/// </summary>
public static class WorkoutCsv
{
    public const int MaxRows = 20_000;

    /// <summary>The header of the downloadable template, which is the export format itself.</summary>
    public static readonly string[] TemplateColumns =
        ["Date", "Exercise", "Set #", "Reps", "Weight", "Duration", "Distance", "Resistance", "Notes"];

    // Compared after lower-casing and folding _ - and # into spaces, so "Set #", "set_number" and
    // "Exercise Name" all find their column.
    private static readonly Dictionary<string, string> Aliases = new()
    {
        ["date"] = "date", ["day"] = "date", ["date and time"] = "date",
        ["exercise"] = "exercise", ["exercise name"] = "exercise",
        ["set"] = "set", ["set number"] = "set", ["set order"] = "set",
        ["reps"] = "reps", ["repetitions"] = "reps",
        ["weight"] = "weight", ["load"] = "weight",
        ["duration"] = "duration", ["seconds"] = "duration",
        ["distance"] = "distance",
        ["resistance"] = "resistance",
        ["notes"] = "notes", ["note"] = "notes",
    };

    private static readonly string[] DateFormats = BuildDateFormats();

    public sealed record Set(int Line, decimal? WeightKg, int? Reps, int? DurationSeconds);

    public sealed class Exercise(string name)
    {
        public string Name { get; } = name;
        public List<Set> Sets { get; } = [];
        public List<string> Notes { get; } = [];
    }

    public sealed class Workout(DateTimeOffset startedAt, int line)
    {
        /// <summary>Set once the exercises are known, from what was trained.</summary>
        public string Name { get; set; } = "Workout";
        public DateTimeOffset StartedAt { get; } = startedAt;
        public int Line { get; } = line;
        public List<Exercise> Exercises { get; } = [];
    }

    public sealed record Error(int Line, string Message);

    /// <summary>What the file shows about an exercise, across all its rows: load, or bare reps.</summary>
    public sealed record ExerciseHints(bool HasWeight, bool HasReps);

    public sealed record Result(
        List<Workout> Workouts, Dictionary<string, ExerciseHints> Hints, List<Error> Errors, int Rows, int EmptySets,
        List<(DateOnly Written, DateOnly Corrected)> CorrectedDates);

    public static Result Parse(
        string text, string units, TimeZoneInfo zone, DateTimeOffset now, AppOptions.PerUserLimits limits)
    {
        var errors = new List<Error>();
        var workouts = new List<Workout>();
        var hints = new Dictionary<string, ExerciseHints>();
        var emptySets = 0;

        var rows = Csv.Read(text, Csv.DetectDelimiter(text));

        // "sep=," is Excel's own hint for which separator to split on - the template starts with it so
        // a European Excel opens it in columns. The separator itself has already been detected from it.
        if (rows.Count > 0 && rows[0].Fields[0].TrimStart().StartsWith("sep=", StringComparison.OrdinalIgnoreCase))
            rows.RemoveAt(0);

        if (rows.Count == 0) return new([], hints, [new(1, "The file is empty.")], 0, 0, []);

        // ---- header ----

        var header = rows[0];
        var columns = new Dictionary<string, int>();
        for (var i = 0; i < header.Fields.Length; i++)
        {
            if (Aliases.TryGetValue(NormalizeHeader(header.Fields[i]), out var column) && !columns.ContainsKey(column))
                columns[column] = i;
        }

        var missing = new[] { "date", "exercise", "reps" }.Where(c => !columns.ContainsKey(c)).ToList();
        if (missing.Count > 0)
        {
            var found = string.Join(", ", header.Fields.Select(f => $"\"{f.Trim()}\""));
            return new([], hints, [new(header.Line,
                $"The first row needs {string.Join(", ", missing.Select(m => $"a {Capitalise(m)}"))} column. It has: {found}. " +
                $"Expected: {string.Join(",", TemplateColumns)}.")], 0, 0, []);
        }

        if (rows.Count - 1 > MaxRows)
            return new([], hints, [new(header.Line, $"The file has {rows.Count - 1:N0} rows; the limit is {MaxRows:N0}.")], rows.Count - 1, 0, []);

        string Cell(Csv.Row row, string column) =>
            columns.TryGetValue(column, out var index) && index < row.Fields.Length ? row.Fields[index].Trim() : "";

        // ---- dates, read first so they can be checked against each other ----

        var data = rows.Skip(1).ToList();
        var dates = data.Select(row => TryParseDate(Cell(row, "date"), out var local, out var hasTime, out var offset)
            ? (Local: local, HasTime: hasTime, Offset: offset)
            : ((DateTime Local, bool HasTime, TimeSpan? Offset)?)null).ToList();
        var corrected = CorrectWeekYears(dates);

        // ---- rows ----

        var byKey = new Dictionary<(DateTime Local, bool HasTime), Workout>();
        var earliest = new DateTimeOffset(1970, 1, 1, 0, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < data.Count; i++)
        {
            var row = data[i];
            void Fail(string message) => errors.Add(new(row.Line, message));

            // -- when --
            var dateText = Cell(row, "date");
            if (dateText.Length == 0) { Fail("The date is empty."); continue; }
            if (dates[i] is not { } when)
            {
                Fail($"\"{dateText}\" is not a date this can read. Use 17-Aug-2023 or 2023-08-17.");
                continue;
            }
            var (local, hasTime, fixedOffset) = when;

            // -- what --
            var exerciseName = Cell(row, "exercise");
            if (exerciseName.Length == 0) { Fail("The exercise is empty."); continue; }
            if (exerciseName.Length > 80) { Fail("The exercise name is longer than 80 characters."); continue; }

            // -- the set itself --
            int? reps = null;
            var repsText = Cell(row, "reps");
            if (repsText.Length > 0)
            {
                if (!TryParseWhole(repsText, out var r) || r is < 0 or > 1000) { Fail($"\"{repsText}\" is not a number of reps."); continue; }
                reps = r;
            }

            int? duration = null;
            var durationText = Cell(row, "duration");
            if (durationText.Length > 0 && durationText != "0")
            {
                if (!TryParseDuration(durationText, out var seconds)) { Fail($"\"{durationText}\" is not a duration. Use seconds, or 1:30."); continue; }
                duration = seconds;
            }

            decimal? weightKg = null;
            var weightText = Cell(row, "weight");
            if (weightText.Length > 0)
            {
                if (!TryParseWeight(weightText, units, out var kg)) { Fail($"\"{weightText}\" is not a weight."); continue; }
                if (kg is < 0 or > 1000) { Fail($"{weightText} is outside 0-1000 kg."); continue; }
                weightKg = Math.Round(kg, 2);
            }

            if (reps is null && duration is null) { Fail("The set has no reps and no duration."); continue; }

            // 0 reps and no time: a set that was planned and never done.
            if (reps is 0 && duration is null) { emptySets++; continue; }

            var note = Cell(row, "notes");

            // -- into a workout --
            var key = (local, hasTime);
            if (!byKey.TryGetValue(key, out var workout))
            {
                // A date with no time starts at noon, which keeps it on its own day in any zone.
                var at = hasTime ? local : local.Date.AddHours(12);
                var startedAt = fixedOffset is { } offset
                    ? new DateTimeOffset(at, offset).ToUniversalTime()
                    : ToUtc(at, zone);

                if (startedAt > now.AddDays(1)) { Fail($"{dateText} is in the future."); continue; }
                if (startedAt < earliest) { Fail($"{dateText} is before 1970."); continue; }

                workout = new Workout(startedAt, row.Line);
                byKey[key] = workout;
                workouts.Add(workout);
            }

            var exercise = workout.Exercises.FirstOrDefault(e => e.Name.Equals(exerciseName, StringComparison.OrdinalIgnoreCase));
            if (exercise is null)
            {
                if (workout.Exercises.Count >= limits.ExercisesPerWorkout)
                {
                    Fail($"The workout on {dateText} has more than {limits.ExercisesPerWorkout} exercises.");
                    continue;
                }
                exercise = new Exercise(exerciseName);
                workout.Exercises.Add(exercise);
            }

            if (exercise.Sets.Count >= limits.SetsPerExercise)
            {
                Fail($"More than {limits.SetsPerExercise} sets of {exercise.Name} on {dateText}.");
                continue;
            }

            exercise.Sets.Add(new Set(row.Line, weightKg, reps, duration));

            // Exports repeat an exercise's note on every one of its sets; keep each distinct note once.
            if (note.Length > 0 && !exercise.Notes.Contains(note)) exercise.Notes.Add(note);

            var normalized = exerciseName.ToLowerInvariant();
            var hint = hints.GetValueOrDefault(normalized) ?? new ExerciseHints(false, false);
            hints[normalized] = new ExerciseHints(hint.HasWeight || weightKg > 0, hint.HasReps || reps > 0);
        }

        return new(workouts, hints, errors, rows.Count - 1, emptySets, corrected);
    }

    /// <summary>
    /// Undoes a common export bug: formatting dates with the week-numbering year ("YYYY") instead of
    /// the calendar year ("yyyy"). In week numbering, the last days of December can belong to week 1
    /// of the next year, so 30 December 2024 comes out as 30-Dec-2025.
    ///
    /// Such a date gives itself away by being out of order. A row dated 29-31 December is moved back a
    /// year only when the rows around it place it there: the date as written falls outside its
    /// neighbours, a year earlier falls between them, and that earlier day really is in the next
    /// year's week 1. A genuine 30 December, in sequence with its neighbours, is left alone. Works for
    /// files sorted either way. Returns each distinct correction, as written and as corrected.
    /// </summary>
    private static List<(DateOnly Written, DateOnly Corrected)> CorrectWeekYears(
        List<(DateTime Local, bool HasTime, TimeSpan? Offset)?> dates)
    {
        static bool Suspect(DateTime d) =>
            d is { Month: 12, Day: >= 29 } && ISOWeek.GetYear(d.AddYears(-1)) == d.Year;

        DateTime? Neighbour(int from, int step)
        {
            for (var i = from + step; i >= 0 && i < dates.Count; i += step)
            {
                if (dates[i] is { } d && !Suspect(d.Local)) return d.Local.Date;
            }
            return null;
        }

        var corrections = new List<(DateOnly, DateOnly)>();
        for (var i = 0; i < dates.Count; i++)
        {
            if (dates[i] is not { } d || !Suspect(d.Local)) continue;
            if (Neighbour(i, -1) is not { } before || Neighbour(i, 1) is not { } after) continue;

            var low = (before < after ? before : after).AddDays(-1);
            var high = (before < after ? after : before).AddDays(1);
            var earlier = d.Local.AddYears(-1);
            var written = d.Local.Date;

            if ((written < low || written > high) && earlier.Date >= low && earlier.Date <= high)
            {
                dates[i] = d with { Local = earlier };
                var pair = (DateOnly.FromDateTime(written), DateOnly.FromDateTime(earlier));
                if (!corrections.Contains(pair)) corrections.Add(pair);
            }
        }
        return corrections;
    }

    /// <summary>A new exercise's kind, from what its rows recorded: load, bare reps, or time.</summary>
    public static Data.Modality InferModality(ExerciseHints hints) =>
        hints.HasWeight ? Data.Modality.WeightReps
        : hints.HasReps ? Data.Modality.BodyweightReps
        : Data.Modality.Duration;

    /// <summary>
    /// A name reduced to letters and digits, so "Pull-ups", "pull ups" and "Pull-Up" can be compared.
    /// </summary>
    public static string LooseKey(string name) =>
        new([.. name.ToLowerInvariant().Where(char.IsLetterOrDigit)]);

    /// <summary>
    /// The short names a hand-kept log uses for catalogue lifts, by loose key. Only the unambiguous
    /// ones: "row", "curl" or "shoulder press" could each be several exercises, so those stay
    /// unmatched and show up in the preview as new.
    /// </summary>
    private static readonly Dictionary<string, string> Shorthand = new()
    {
        ["bench"] = "Barbell Bench Press",
        ["benchpress"] = "Barbell Bench Press",
        ["flatbench"] = "Barbell Bench Press",
        ["squat"] = "Back Squat",
        ["ohp"] = "Overhead Press",
        ["militarypress"] = "Overhead Press",
        ["rdl"] = "Romanian Deadlift",
        ["sldl"] = "Stiff-Leg Deadlift",
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

    // ---- cells ----

    private static string NormalizeHeader(string value) =>
        string.Join(' ', value.Trim().ToLowerInvariant().Replace('_', ' ').Replace('-', ' ').Replace('#', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static string Capitalise(string column) => char.ToUpperInvariant(column[0]) + column[1..];

    private static string[] BuildDateFormats()
    {
        string[] days =
        [
            "dd-MMM-yyyy", "d-MMM-yyyy", "dd MMM yyyy", "d MMM yyyy",
            "yyyy-MM-dd", "yyyy-M-d", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d.M.yyyy",
        ];
        string[] times = ["", " HH:mm", " H:mm", " HH:mm:ss", " H:mm:ss", "'T'HH:mm", "'T'HH:mm:ss"];
        return [.. days.SelectMany(d => times.Select(t => d + t))];
    }

    /// <summary>
    /// 17-Aug-2023 as exports write it, ISO dates, or day-first with dots or dashes. Slashes are
    /// refused: 03/04/2026 is March in one country and April in the next.
    /// </summary>
    private static bool TryParseDate(string text, out DateTime local, out bool hasTime, out TimeSpan? offset)
    {
        offset = null;
        hasTime = false;

        if (DateTime.TryParseExact(text, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out local))
        {
            hasTime = text.Contains(':');
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
