using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Data;
using RepTracker.Api.Endpoints;

namespace RepTracker.Api.Stats;

/// <summary>
/// Sessions of one exercise that look like logging mistakes - 90 kg typed on a machine that is
/// pressed at 45 - each with values worked out from the sessions either side, to put in their place.
/// The same review is available for any one session, picked from a chart, flagged or not.
///
/// A session is flagged when its top set is more than <see cref="Threshold"/> times above or below
/// every one of the <see cref="Window"/> sessions before it and after it. Every one, and on both
/// sides, because that is what a typo looks like and a real change does not: genuine progress is
/// still there next time, and a lifter who alternates a heavy and a light variant under one name
/// matches a session two back. Tuned on the owner's own 2,840 sessions (2026-10-21): comparing with
/// the immediate neighbours alone at 1.3x flagged 172 of them, mostly such alternations; this flags
/// 39, the typos among them. So the first and latest sessions are never flagged - there is nothing
/// on one side to judge them by - and a typo is only caught once a session follows it.
/// </summary>
public static class Outliers
{
    public const decimal Threshold = 1.75m;
    public const int Window = 3;

    private const decimal LbPerKg = 2.2046226218m;

    public static async Task<List<SessionReviewDto>> FindAsync(
        AppDb db, Guid userId, Guid exerciseId, string units, CancellationToken ct)
    {
        var sessions = await LoadAsync(db, userId, exerciseId, ct);
        var tops = sessions.Select(s => Top(s.Modality, s.Sets)).ToList();

        var found = new List<SessionReviewDto>();
        for (var i = 1; i < sessions.Count - 1; i++)
        {
            if (tops[i] is not { } top) continue;

            var earlier = tops.Take(i).TakeLast(Window).OfType<decimal>().ToList();
            var later = tops.Skip(i + 1).Take(Window).OfType<decimal>().ToList();
            if (earlier.Count == 0 || later.Count == 0) continue;
            if (!earlier.Concat(later).All(other => FarApart(top, other))) continue;

            found.Add(Review(sessions, i, units));
        }

        return found;
    }

    /// <summary>
    /// One session of the exercise - its first appearance in the workout, should it have two - with
    /// the sessions either side and values worked out from them. Null if the workout has none of it.
    /// </summary>
    public static async Task<SessionReviewDto?> ReviewAsync(
        AppDb db, Guid userId, Guid exerciseId, Guid workoutId, string units, CancellationToken ct)
    {
        var sessions = await LoadAsync(db, userId, exerciseId, ct);
        var index = sessions.FindIndex(s => s.WorkoutId == workoutId);
        return index < 0 ? null : Review(sessions, index, units);
    }

    private record Session(
        Guid Id, Guid WorkoutId, DateTimeOffset StartedAt, int Position, Modality Modality, List<WorkoutSet> Sets);

    /// <summary>Every finished session of the exercise with a completed set, oldest first.</summary>
    private static async Task<List<Session>> LoadAsync(AppDb db, Guid userId, Guid exerciseId, CancellationToken ct)
    {
        var rows = await db.WorkoutExercises
            .Where(we => we.ExerciseId == exerciseId && we.Workout.UserId == userId && we.Workout.FinishedAt != null)
            .Select(we => new
            {
                we.Id,
                we.WorkoutId,
                we.Workout.StartedAt,
                we.Position,
                we.Exercise.Modality,
                Sets = we.Sets.Where(s => s.IsCompleted).OrderBy(s => s.Position).ToList(),
            })
            .ToListAsync(ct);

        return rows
            .Where(r => r.Sets.Count > 0)
            .OrderBy(r => r.StartedAt).ThenBy(r => r.Position)
            .Select(r => new Session(r.Id, r.WorkoutId, r.StartedAt, r.Position, r.Modality, r.Sets))
            .ToList();
    }

    /// <summary>
    /// Session <paramref name="i"/> beside its neighbours, with each set's suggested replacement. The
    /// first and latest have a neighbour on one side only, and suggestions come from that side.
    /// </summary>
    private static SessionReviewDto Review(List<Session> sessions, int i, string units)
    {
        var session = sessions[i];
        var before = i > 0 ? sessions[i - 1] : null;
        var after = i < sessions.Count - 1 ? sessions[i + 1] : null;

        var suggested = session.Sets
            .Select((set, index) => Suggest(set, Match(before?.Sets, index), Match(after?.Sets, index), units))
            .ToList();

        return new SessionReviewDto(
            session.WorkoutId, session.Id, session.StartedAt, session.Modality,
            [.. session.Sets.Select(s => s.ToDto())],
            suggested,
            before is null ? null : new SessionNeighbourDto(before.StartedAt, [.. before.Sets.Select(Previous)]),
            after is null ? null : new SessionNeighbourDto(after.StartedAt, [.. after.Sets.Select(Previous)]));
    }

    /// <summary>
    /// The number a mistake shows up in, per kind of exercise: the heaviest weight, or for bodyweight
    /// moves - usually logged with no added load - the most reps; the longest hold; the furthest distance.
    /// </summary>
    private static decimal? Top(Modality modality, List<WorkoutSet> sets) => modality switch
    {
        Modality.WeightReps => sets.Max(s => s.WeightKg),
        Modality.BodyweightReps => sets.Max(s => (decimal?)s.Reps),
        Modality.Duration => sets.Max(s => (decimal?)s.DurationSeconds),
        Modality.DistanceDuration => sets.Max(s => s.DistanceM),
        _ => null,
    };

    /// <summary>
    /// More than <see cref="Threshold"/> times apart. A zero against anything else counts as far -
    /// "0 kg" on a loaded machine is a typo - and two zeros as close.
    /// </summary>
    private static bool FarApart(decimal a, decimal b)
    {
        if (a <= 0 || b <= 0) return (a <= 0) != (b <= 0);
        return Math.Max(a, b) > Math.Min(a, b) * Threshold;
    }

    /// <summary>The neighbour's set in the same place, or its last one when it had fewer; none without a neighbour.</summary>
    private static WorkoutSet? Match(List<WorkoutSet>? sets, int index) =>
        sets is null ? null : index < sets.Count ? sets[index] : sets[^1];

    /// <summary>
    /// Each value the average of the two neighbouring sets - weight and reps both, as the owner chose.
    /// A value only one side has is taken from that side; one neither has is left as logged.
    /// </summary>
    private static SuggestedSetDto Suggest(WorkoutSet set, WorkoutSet? before, WorkoutSet? after, string units) =>
        new(set.Id,
            RoundWeight(Average(before?.WeightKg, after?.WeightKg), units) ?? set.WeightKg,
            RoundCount(Average(before?.Reps, after?.Reps)) ?? set.Reps,
            RoundCount(Average(before?.DurationSeconds, after?.DurationSeconds)) ?? set.DurationSeconds,
            Round2(Average(before?.DistanceM, after?.DistanceM)) ?? set.DistanceM);

    private static decimal? Average(decimal? a, decimal? b) =>
        a is { } x && b is { } y ? (x + y) / 2 : a ?? b;

    private static decimal? Average(int? a, int? b) => Average((decimal?)a, (decimal?)b);

    private static int? RoundCount(decimal? value) =>
        value is { } v ? (int)Math.Round(v, MidpointRounding.AwayFromZero) : null;

    private static decimal? Round2(decimal? value) => value is { } v ? Math.Round(v, 2) : null;

    /// <summary>
    /// To a quarter kilo, or half a pound for someone who lifts in pounds - fine enough to keep the
    /// average, coarse enough to read as a weight someone would load.
    /// </summary>
    private static decimal? RoundWeight(decimal? kg, string units)
    {
        if (kg is not { } value) return null;
        if (units != "lb") return Math.Round(value * 4, MidpointRounding.AwayFromZero) / 4;

        var pounds = Math.Round(value * LbPerKg * 2, MidpointRounding.AwayFromZero) / 2;
        return Math.Round(pounds / LbPerKg, 2);
    }

    private static PreviousSetDto Previous(WorkoutSet s) => new(s.WeightKg, s.Reps, s.DurationSeconds, s.DistanceM);
}
