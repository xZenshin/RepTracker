using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Data;

namespace RepTracker.Api.Stats;

/// <summary>
/// Computes every figure the dashboard shows.
///
/// The approach is deliberately to pull narrow projections for the window in question and do the
/// arithmetic in memory, rather than to express a dozen window functions in SQL. One person's
/// training history is a few thousand rows a year, so this is cheap, and it keeps rules like
/// "only completed sets count" and "above twelve reps is not strength data" in one readable place.
/// </summary>
public class StatsService(AppDb db)
{
    /// <summary>How far back personal-record history is reconstructed. Older lifts stay in the log.</summary>
    private static readonly TimeSpan RecordHistory = TimeSpan.FromDays(365 * 3);

    /// <summary>An exercise still in the rotation but stuck for this long is worth flagging.</summary>
    private const int StallWeeks = 6;

    /// <summary>Three weeks away from a movement means it has left the rotation, not stalled.</summary>
    private const int RetiredDays = 21;

    /// <summary>How recently a best must have been beaten to be flagged as a new record.</summary>
    private const int RecentRecordDays = 30;

    /// <summary>Periods up to this long chart volume per day; longer ones per week.</summary>
    private const int DailyVolumeMaxWeeks = 13;

    private const decimal WeeklySetTargetLow = 10m;
    private const decimal WeeklySetTargetHigh = 20m;

    private sealed record SetRow(
        Guid WorkoutId, DateTimeOffset StartedAt, Guid ExerciseId, string ExerciseName,
        string MuscleGroup, string Pattern, Modality Modality,
        decimal? WeightKg, int? Reps, int? DurationSeconds);

    private sealed record WorkoutRow(Guid Id, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt);

    public async Task<OverviewDto> OverviewAsync(
        Guid userId, decimal? bodyWeightKg, int weeks, int offsetMinutes, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var currentWeek = WeekStartOf(now, offsetMinutes);
        var firstWeek = currentWeek.AddDays(-7 * (weeks - 1));
        var since = LocalMidnightUtc(firstWeek, offsetMinutes);

        var workouts = await AllWorkoutsAsync(userId, ct);
        var windowSets = await WorkingSetsAsync(userId, since, ct);

        return new OverviewDto(
            Totals(workouts, windowSets, since, bodyWeightKg, weeks),
            Consistency(workouts, offsetMinutes, currentWeek),
            VolumeSeries(workouts, windowSets, bodyWeightKg, firstWeek, weeks, now, offsetMinutes),
            MuscleGroups(windowSets, bodyWeightKg, weeks),
            Balance(windowSets));
    }

    /// <summary>
    /// One entry per day with a finished workout, over the same Monday-start window as the
    /// overview. Days come from workouts rather than sets so the calendar marks exactly the
    /// workouts the overview counts - including one finished without a ticked working set.
    /// </summary>
    public async Task<List<CalendarDayDto>> CalendarAsync(
        Guid userId, decimal? bodyWeightKg, int weeks, int offsetMinutes, CancellationToken ct)
    {
        var firstWeek = WeekStartOf(DateTimeOffset.UtcNow, offsetMinutes).AddDays(-7 * (weeks - 1));
        var since = LocalMidnightUtc(firstWeek, offsetMinutes);

        var workouts = await db.Workouts
            .Where(w => w.UserId == userId && w.FinishedAt != null && w.StartedAt >= since)
            .Select(w => w.StartedAt)
            .ToListAsync(ct);

        var setsByDay = (await WorkingSetsAsync(userId, since, ct))
            .GroupBy(s => LocalDate(s.StartedAt, offsetMinutes))
            .ToDictionary(g => g.Key, g => g.ToList());

        return [.. workouts
            .GroupBy(startedAt => LocalDate(startedAt, offsetMinutes))
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var sets = setsByDay.GetValueOrDefault(g.Key) ?? [];
                return new CalendarDayDto(
                    g.Key, g.Count(), Math.Round(sets.Sum(s => Volume(s, bodyWeightKg)), 1), sets.Count);
            })];
    }

    /// <summary>
    /// Every exercise the user has actually trained, with its bests and whether it has just set a
    /// record or stalled. This is the stats page's exercise list and the picker on each exercise.
    /// </summary>
    public async Task<List<ExerciseListItemDto>> ExerciseListAsync(
        Guid userId, decimal? bodyWeightKg, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var history = await WorkingSetsAsync(userId, now - RecordHistory, ct);
        var activity = await PerExerciseActivityAsync(userId, ct);

        // The replay is chronological and only ever emits a higher estimate, so each exercise's
        // last record is its current best, stamped with the moment it was first reached.
        var bestByExercise = BuildRecordHistory(history, bodyWeightKg)
            .GroupBy(r => r.ExerciseId)
            .ToDictionary(g => g.Key, g => g.Last());
        var stalled = Stalled(bestByExercise, history, activity, now);

        return [.. history
            .GroupBy(s => s.ExerciseId)
            .Select(g =>
            {
                var best = bestByExercise.GetValueOrDefault(g.Key);
                var heaviest = g.Select(s => Load(s, bodyWeightKg)).DefaultIfEmpty(0m).Max();
                var first = g.First();

                // A first-ever session is technically a record too, but flagging every new exercise
                // would bury the real ones, so a record has to beat an earlier best.
                var status =
                    best is { PreviousBest: not null } && (now - best.AchievedAt).TotalDays <= RecentRecordDays ? "record"
                    : stalled.Contains(g.Key) ? "stalled"
                    : null;

                return new ExerciseListItemDto(
                    g.Key, first.ExerciseName, first.MuscleGroup, first.Modality,
                    g.Select(s => s.WorkoutId).Distinct().Count(),
                    g.Max(s => s.StartedAt),
                    best?.EstimatedOneRepMax,
                    best?.AchievedAt,
                    heaviest > 0 ? heaviest : null,
                    status);
            })
            .OrderByDescending(x => x.LastPerformedAt)];
    }

    public async Task<ExerciseStatsDto?> ExerciseAsync(
        Guid userId, Guid exerciseId, decimal? bodyWeightKg, int weeks, int offsetMinutes, CancellationToken ct)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-7 * weeks);
        var rows = await WorkingSetsAsync(userId, since, ct, exerciseId);
        if (rows.Count == 0) return null;

        var meta = rows[0];

        // A running maximum over sessions in order is what turns a scatter of sets into the
        // "when did I actually get stronger" markers on the chart.
        decimal runningBest = 0;
        var sessions = new List<ExerciseSessionPointDto>();

        foreach (var group in rows.GroupBy(r => r.WorkoutId).OrderBy(g => g.Min(r => r.StartedAt)))
        {
            var sets = group.ToList();
            var sessionBest = sets.Select(s => OneRepMax(s, bodyWeightKg)).Where(x => x is not null).DefaultIfEmpty().Max();
            var topSet = sets.OrderByDescending(s => Load(s, bodyWeightKg)).ThenByDescending(s => s.Reps).First();

            var isRecord = sessionBest is { } b && b > runningBest;
            if (isRecord) runningBest = sessionBest!.Value;

            sessions.Add(new ExerciseSessionPointDto(
                group.Key,
                LocalDate(sets[0].StartedAt, offsetMinutes),
                sessionBest,
                topSet.WeightKg,
                topSet.Reps,
                Math.Round(sets.Sum(s => Volume(s, bodyWeightKg)), 1),
                sets.Count,
                sets.Sum(s => s.Reps ?? 0),
                isRecord));
        }

        return new ExerciseStatsDto(
            exerciseId, meta.ExerciseName, meta.MuscleGroup, meta.Modality,
            sessions,
            ExerciseRecords(rows, sessions, bodyWeightKg, offsetMinutes),
            Trend(sessions));
    }

    // ---- overview sections ----

    private static PeriodTotals Totals(
        List<WorkoutRow> workouts, List<SetRow> sets, DateTimeOffset since, decimal? bodyWeightKg, int weeks)
    {
        var inWindow = workouts.Where(w => w.StartedAt >= since).ToList();
        var seconds = inWindow
            .Where(w => w.FinishedAt is not null)
            .Sum(w => (int)(w.FinishedAt!.Value - w.StartedAt).TotalSeconds);

        return new PeriodTotals(
            inWindow.Count,
            Math.Round(sets.Sum(s => Volume(s, bodyWeightKg)), 1),
            sets.Count,
            sets.Sum(s => s.Reps ?? 0),
            seconds,
            Math.Round((decimal)inWindow.Count / weeks, 2));
    }

    private static ConsistencyDto Consistency(
        List<WorkoutRow> workouts, int offsetMinutes, DateOnly currentWeek)
    {
        var activeWeeks = workouts
            .Select(w => WeekStartOf(w.StartedAt, offsetMinutes))
            .ToHashSet();

        var longest = 0;
        var run = 0;
        foreach (var week in activeWeeks.OrderBy(w => w))
        {
            run = activeWeeks.Contains(week.AddDays(-7)) ? run + 1 : 1;
            longest = Math.Max(longest, run);
        }

        // A week that has only just started should not break a streak, so counting begins at the
        // current week if it already has a session and at last week otherwise.
        var cursor = activeWeeks.Contains(currentWeek) ? currentWeek : currentWeek.AddDays(-7);
        var current = 0;
        while (activeWeeks.Contains(cursor))
        {
            current++;
            cursor = cursor.AddDays(-7);
        }

        return new ConsistencyDto(
            current, longest,
            workouts.Count(w => WeekStartOf(w.StartedAt, offsetMinutes) == currentWeek),
            activeWeeks.Count,
            workouts.Count);
    }

    private static VolumeSeriesDto VolumeSeries(
        List<WorkoutRow> workouts, List<SetRow> sets, decimal? bodyWeightKg,
        DateOnly firstWeek, int weeks, DateTimeOffset now, int offsetMinutes)
    {
        // A short period in weeks is only a handful of bars, so it is charted by day instead. A daily
        // series stops at today: days that have not happened yet are not rest days.
        var daily = weeks <= DailyVolumeMaxWeeks;
        var stepDays = daily ? 1 : 7;
        var rollingPoints = daily ? 7 : 4;
        var count = daily ? LocalDate(now, offsetMinutes).DayNumber - firstWeek.DayNumber + 1 : weeks;

        DateOnly BucketOf(DateTimeOffset at) =>
            daily ? LocalDate(at, offsetMinutes) : WeekStartOf(at, offsetMinutes);

        var setsByBucket = sets
            .GroupBy(s => BucketOf(s.StartedAt))
            .ToDictionary(g => g.Key, g => (Volume: g.Sum(s => Volume(s, bodyWeightKg)), Sets: g.Count()));

        var workoutsByBucket = workouts
            .GroupBy(w => BucketOf(w.StartedAt))
            .ToDictionary(
                g => g.Key,
                g => (Count: g.Count(),
                      Seconds: g.Where(w => w.FinishedAt is not null)
                               .Sum(w => (int)(w.FinishedAt!.Value - w.StartedAt).TotalSeconds)));

        // Days and weeks with no training are emitted as zeroes rather than skipped: a gap in a volume
        // chart should be visible as a gap, not smoothed over by the next bar sliding left.
        var points = new List<VolumePointDto>(count);
        var volumes = new List<decimal>(count);

        for (var i = 0; i < count; i++)
        {
            var start = firstWeek.AddDays(stepDays * i);
            var s = setsByBucket.GetValueOrDefault(start);
            var w = workoutsByBucket.GetValueOrDefault(start);

            volumes.Add(s.Volume);
            var rolling = volumes.Skip(Math.Max(0, volumes.Count - rollingPoints)).Average();

            points.Add(new VolumePointDto(
                start, w.Count, Math.Round(s.Volume, 1), s.Sets, w.Seconds, Math.Round(rolling, 1)));
        }

        return new VolumeSeriesDto(daily ? "day" : "week", rollingPoints, points);
    }

    private static List<MuscleGroupLoadDto> MuscleGroups(List<SetRow> sets, decimal? bodyWeightKg, int weeks)
    {
        var byGroup = sets
            .Where(s => s.Modality is Modality.WeightReps or Modality.BodyweightReps)
            .GroupBy(s => s.MuscleGroup)
            .ToDictionary(g => g.Key, g => (Sets: g.Count(), Volume: g.Sum(s => Volume(s, bodyWeightKg))));

        return [.. ExerciseCatalog.MuscleGroups
            .Where(g => g != "Cardio")
            .Select(group =>
            {
                var data = byGroup.GetValueOrDefault(group);
                var perWeek = Math.Round((decimal)data.Sets / weeks, 1);

                return new MuscleGroupLoadDto(
                    group, data.Sets, Math.Round(data.Volume, 1), perWeek, Verdict(perWeek));
            })];

        static string Verdict(decimal perWeek) => perWeek switch
        {
            0 => "untrained",
            < WeeklySetTargetLow => "low",
            <= WeeklySetTargetHigh => "on target",
            _ => "high",
        };
    }

    private static BalanceDto Balance(List<SetRow> sets)
    {
        int Count(string pattern) => sets.Count(s => s.Pattern == pattern);

        var push = Count("push");
        var pull = Count("pull");
        var legs = Count("legs");
        var core = Count("core");
        var cardio = Count("cardio");

        return new BalanceDto(
            push, pull, legs, core, cardio,
            pull > 0 ? Math.Round((decimal)push / pull, 2) : null,
            legs > 0 ? Math.Round((decimal)(push + pull) / legs, 2) : null);
    }

    /// <summary>
    /// Replays strength sets in chronological order and emits an entry every time an exercise's
    /// best estimated 1RM is beaten. Reconstructing PRs this way means the feed stays correct even
    /// after a set is edited or deleted, with no separate records table to keep in sync.
    /// </summary>
    private static List<RecordDto> BuildRecordHistory(List<SetRow> history, decimal? bodyWeightKg)
    {
        var best = new Dictionary<Guid, decimal>();
        var records = new List<RecordDto>();

        foreach (var set in history.OrderBy(s => s.StartedAt))
        {
            if (OneRepMax(set, bodyWeightKg) is not { } estimate) continue;

            var previous = best.GetValueOrDefault(set.ExerciseId);
            if (estimate <= previous) continue;

            best[set.ExerciseId] = estimate;
            records.Add(new RecordDto(
                set.ExerciseId, set.ExerciseName, set.StartedAt, estimate,
                Load(set, bodyWeightKg), set.Reps ?? 0, previous > 0 ? previous : null));
        }

        return records;
    }

    /// <summary>Exercises whose best estimated 1RM has not moved despite continued training.</summary>
    private static HashSet<Guid> Stalled(
        Dictionary<Guid, RecordDto> bestByExercise, List<SetRow> history,
        Dictionary<Guid, (DateTimeOffset Last, int Sessions)> activity, DateTimeOffset now)
    {
        var result = new HashSet<Guid>();

        foreach (var (exerciseId, record) in bestByExercise)
        {
            if (!activity.TryGetValue(exerciseId, out var a)) continue;

            // Only flag movements that are still part of training. An exercise you stopped doing
            // months ago is not stalled, it is retired.
            if ((now - a.Last).TotalDays > RetiredDays) continue;

            if ((now - record.AchievedAt).TotalDays / 7 < StallWeeks) continue;

            var sessionsSince = history
                .Where(s => s.ExerciseId == exerciseId && s.StartedAt > record.AchievedAt)
                .Select(s => s.WorkoutId)
                .Distinct()
                .Count();

            // Needs a few attempts since the record before "stalled" is a fair description.
            if (sessionsSince < 3) continue;

            result.Add(exerciseId);
        }

        return result;
    }

    // ---- per-exercise sections ----

    private static ExerciseRecordsDto ExerciseRecords(
        List<SetRow> rows, List<ExerciseSessionPointDto> sessions, decimal? bodyWeightKg, int offsetMinutes)
    {
        var withEstimate = rows
            .Select(r => new { Row = r, Estimate = OneRepMax(r, bodyWeightKg) })
            .Where(x => x.Estimate is not null)
            .ToList();

        var bestEstimate = withEstimate.MaxBy(x => x.Estimate);
        var heaviest = rows.Where(r => Load(r, bodyWeightKg) > 0).MaxBy(r => Load(r, bodyWeightKg));
        var bestVolume = sessions.MaxBy(s => s.VolumeKg);

        // Most reps ever achieved at each load, which is how progress shows up between jumps in weight.
        var repRecords = rows
            .Where(r => r.Reps is > 0 && Load(r, bodyWeightKg) > 0)
            .GroupBy(r => Load(r, bodyWeightKg))
            .Select(g => g.MaxBy(r => r.Reps)!)
            .OrderByDescending(r => Load(r, bodyWeightKg))
            .Take(12)
            .Select(r => new RepRecordDto(
                Load(r, bodyWeightKg), r.Reps!.Value, LocalDate(r.StartedAt, offsetMinutes)))
            .ToList();

        return new ExerciseRecordsDto(
            bestEstimate?.Estimate, bestEstimate?.Row.StartedAt,
            heaviest is null ? null : Load(heaviest, bodyWeightKg), heaviest?.Reps, heaviest?.StartedAt,
            bestVolume?.VolumeKg,
            bestVolume is null ? null : rows.First(r => r.WorkoutId == bestVolume.WorkoutId).StartedAt,
            repRecords);
    }

    /// <summary>
    /// Compares the average estimated 1RM of the most recent third of sessions against the earliest
    /// third. Averaging both ends keeps one unusually good or bad day from reading as a trend.
    /// </summary>
    private static TrendDto Trend(List<ExerciseSessionPointDto> sessions)
    {
        var points = sessions.Where(s => s.EstimatedOneRepMax is not null).ToList();
        if (points.Count < 4) return new TrendDto(null, null, null, "insufficient data");

        var slice = Math.Max(2, points.Count / 3);
        var earlier = points.Take(slice).Average(s => s.EstimatedOneRepMax!.Value);
        var recent = points.TakeLast(slice).Average(s => s.EstimatedOneRepMax!.Value);

        if (earlier <= 0) return new TrendDto(null, null, null, "insufficient data");

        var change = Math.Round((recent - earlier) / earlier * 100m, 1);
        var direction = change switch
        {
            > 2m => "improving",
            < -2m => "declining",
            _ => "holding",
        };

        return new TrendDto(change, Math.Round(recent, 1), Math.Round(earlier, 1), direction);
    }

    // ---- data access ----

    private Task<List<WorkoutRow>> AllWorkoutsAsync(Guid userId, CancellationToken ct) =>
        db.Workouts
            .Where(w => w.UserId == userId && w.FinishedAt != null)
            .OrderBy(w => w.StartedAt)
            .Select(w => new WorkoutRow(w.Id, w.StartedAt, w.FinishedAt))
            .ToListAsync(ct);

    /// <summary>
    /// Completed sets in a window. Unticked rows are filtered out at the source, so no caller
    /// downstream has to remember to exclude them.
    /// </summary>
    private Task<List<SetRow>> WorkingSetsAsync(
        Guid userId, DateTimeOffset since, CancellationToken ct, Guid? exerciseId = null)
    {
        var query = db.Sets
            .Where(s => s.WorkoutExercise.Workout.UserId == userId
                        && s.WorkoutExercise.Workout.FinishedAt != null
                        && s.WorkoutExercise.Workout.StartedAt >= since
                        && s.IsCompleted);

        if (exerciseId is not null)
            query = query.Where(s => s.WorkoutExercise.ExerciseId == exerciseId);

        return query
            .OrderBy(s => s.WorkoutExercise.Workout.StartedAt)
            .Select(s => new SetRow(
                s.WorkoutExercise.WorkoutId,
                s.WorkoutExercise.Workout.StartedAt,
                s.WorkoutExercise.ExerciseId,
                s.WorkoutExercise.Exercise.Name,
                s.WorkoutExercise.Exercise.MuscleGroup,
                s.WorkoutExercise.Exercise.Pattern,
                s.WorkoutExercise.Exercise.Modality,
                s.WeightKg,
                s.Reps,
                s.DurationSeconds))
            .ToListAsync(ct);
    }

    private Task<Dictionary<Guid, (DateTimeOffset Last, int Sessions)>> PerExerciseActivityAsync(
        Guid userId, CancellationToken ct) =>
        db.WorkoutExercises
            .Where(we => we.Workout.UserId == userId && we.Workout.FinishedAt != null)
            .GroupBy(we => we.ExerciseId)
            .Select(g => new { ExerciseId = g.Key, Last = g.Max(x => x.Workout.StartedAt), Sessions = g.Count() })
            .ToDictionaryAsync(x => x.ExerciseId, x => (x.Last, x.Sessions), ct);

    // ---- helpers ----

    private static decimal Load(SetRow s, decimal? bodyWeightKg) =>
        Formulas.EffectiveLoadKg(s.Modality, s.WeightKg, bodyWeightKg);

    private static decimal Volume(SetRow s, decimal? bodyWeightKg) =>
        Formulas.SetVolumeKg(s.Modality, s.WeightKg, s.Reps, bodyWeightKg);

    private static decimal? OneRepMax(SetRow s, decimal? bodyWeightKg) =>
        Formulas.EstimatedOneRepMax(Load(s, bodyWeightKg), s.Reps);

    /// <summary>
    /// Local midnight on a date, converted to UTC: Npgsql only binds timestamptz parameters with a
    /// zero offset, so every window start goes through here.
    /// </summary>
    private static DateTimeOffset LocalMidnightUtc(DateOnly date, int offsetMinutes) =>
        new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.FromMinutes(offsetMinutes)).ToUniversalTime();

    private static DateOnly LocalDate(DateTimeOffset utc, int offsetMinutes) =>
        DateOnly.FromDateTime(utc.ToOffset(TimeSpan.FromMinutes(offsetMinutes)).DateTime);

    /// <summary>Monday of the week a timestamp falls in, as the user's own clock saw it.</summary>
    private static DateOnly WeekStartOf(DateTimeOffset utc, int offsetMinutes)
    {
        var date = LocalDate(utc, offsetMinutes);
        var daysSinceMonday = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-daysSinceMonday);
    }
}
