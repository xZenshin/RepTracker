using System.Globalization;
using System.Text;

namespace RepTracker.Api.Import;

/// <summary>
/// Writes workouts in the format <see cref="WorkoutCsv"/> reads - one row per completed set,
/// <c>Date,Exercise,Set #,Reps,Weight,Duration,Distance,Resistance,Notes</c> - so an export imports
/// straight back, here or into another account. Pure, like the reader.
///
/// The date carries the local time a workout started, because without it a re-import could neither
/// tell two workouts on one day apart nor recognise a workout it already has. A workout starting at
/// noon exactly - which is how the importer files an untimed date - is written as the date alone,
/// so an imported log comes back out the way it went in.
/// </summary>
public static class WorkoutCsvExport
{
    public sealed record Set(int? Reps, decimal? WeightKg, int? DurationSeconds, decimal? DistanceM);

    public sealed record Exercise(string Name, string? Notes, IReadOnlyList<Set> Sets);

    public sealed record Workout(DateTimeOffset StartedAt, IReadOnlyList<Exercise> Exercises);

    public static string Write(IEnumerable<Workout> workouts, string units, TimeZoneInfo zone)
    {
        var csv = new StringBuilder();
        csv.Append(string.Join(',', WorkoutCsv.TemplateColumns)).Append("\r\n");

        foreach (var workout in workouts)
        {
            var local = TimeZoneInfo.ConvertTime(workout.StartedAt, zone).DateTime;
            var date = local.TimeOfDay == TimeSpan.FromHours(12)
                ? local.ToString("dd-MMM-yyyy", CultureInfo.InvariantCulture)
                : local.ToString("dd-MMM-yyyy HH:mm", CultureInfo.InvariantCulture);

            foreach (var exercise in workout.Exercises)
            {
                for (var i = 0; i < exercise.Sets.Count; i++)
                {
                    var set = exercise.Sets[i];
                    // No weight stays an empty cell, as it came in; 0 stays 0.
                    var weight = set.WeightKg is { } kg ? Number(units == "lb" ? kg * 2.20462262m : kg) : "";

                    csv.Append(Field(date)).Append(',')
                        .Append(Field(exercise.Name)).Append(',')
                        .Append(i + 1).Append(',')
                        .Append(set.Reps ?? 0).Append(',')
                        .Append(weight).Append(',')
                        .Append(set.DurationSeconds ?? 0).Append(',')
                        // Kilometres, the unit a training log usually means; empty when nothing was run.
                        .Append(set.DistanceM is { } m ? Number(m / 1000m, 3) : "").Append(',')
                        .Append(',')
                        .Append(Field(exercise.Notes ?? ""))
                        .Append("\r\n");
                }
            }
        }

        return csv.ToString();
    }

    /// <summary>A plain number with a decimal point, never a comma, and no trailing zeros: 102.5, 60.</summary>
    private static string Number(decimal value, int decimals = 2) =>
        Math.Round(value, decimals).ToString("0.###", CultureInfo.InvariantCulture);

    /// <summary>Quoted only when it has to be: a comma, a quote or a line break inside.</summary>
    private static string Field(string value) =>
        value.IndexOfAny([',', '"', '\r', '\n']) < 0 ? value : $"\"{value.Replace("\"", "\"\"")}\"";
}
