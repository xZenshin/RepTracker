using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Data;

namespace RepTracker.Api.Stats;

/// <summary>
/// Computes every figure the dashboard shows.
///
/// The approach is deliberately to pull narrow projections for the window in question and do the
/// arithmetic in memory, rather than to express a dozen window functions in SQL. One person's
/// training history is a few thousand rows a year, so this is cheap, and it keeps rules like
/// "warm-ups never count" and "above twelve reps is not strength data" in one readable place.
/// </summary>
public class StatsService(AppDb db)
{
    /// <summary>How far back personal-record history is reconstructed. Older lifts stay in the log.</summary>
    private static readonly TimeSpan RecordHistory = TimeSpan.FromDays(365 * 3);

    /// <summary>An exercise still in the rotation but stuck for this long is worth flagging.</summary>
    private const int StallWeeks = 6;

    /// <summary>Rest days are healthy; three weeks away from a movement in your own plan is drift.</summary>
    private const int NeglectedDays = 21;

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
        // The window starts at local midnight on that Monday, converted to UTC: Npgsql only binds
        // timestamptz parameters with a zero offset.
        var since = new DateTimeOffset(firstWeek.ToDateTime(TimeOnly.MinValue), TimeSpan.FromMinutes(offsetMinutes))
            .ToUniversalTime();

        var workouts = await AllWorkoutsAsync(userId, ct);
        var windowSets = await WorkingSetsAsync(userId, since, ct);
        var strengthHistory = await WorkingSetsAsync(userId, now - RecordHistory, ct);
        var perExercise = await PerExerciseActivityAsync(userId, ct);

        var records = BuildRecordHistory(strengthHistory, bodyWeightKg);

        return new OverviewDto(
            Totals(workouts, windowSets, since, bodyWeightKg, weeks),
            Consistency(workouts, offsetMinutes, currentWeek),
            Weekly(workouts, windowSets, bodyWeightKg, firstWeek, weeks, offsetMinutes),
            MuscleGroups(windowSets, bodyWeightKg, weeks),
            Balance(windowSets),
            [.. records.Where(r => r.AchievedAt >= since).OrderByDescending(r => r.AchievedAt).Take(15)],
            Stalling(records, strengthHistory, perExercise, now),
            await NeglectedAsync(userId, perExercise, now, ct));
    }

    public async Task<List<CalendarDayDto>> CalendarAsync(
        Guid userId, decimal? bodyWeightKg, int weeks, int offsetMinutes, CancellationToken ct)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-7 * weeks);
        var sets = await WorkingSetsAsync(userId, since, ct);

        return [.. sets
            .GroupBy(s => LocalDate(s.StartedAt, offsetMinutes))
            .OrderBy(g => g.Key)
            .Select(g => new CalendarDayDto(
                g.Key,
                g.Select(s => s.WorkoutId).Distinct().Count(),
                Math.Round(g.Sum(s => Volume(s, bodyWeightKg)), 1),
                g.Count()))];
    }

    /// <summary>Every exercise the user has actually trained, for the picker on the stats page.</summary>
    public async Task<List<ExerciseListItemDto>> ExerciseListAsync(
        Guid userId, decimal? bodyWeightKg, CancellationToken ct)
    {
        var history = await WorkingSetsAsync(userId, DateTimeOffset.UtcNow - RecordHistory, ct);

        return [.. history
            .GroupBy(s => s.ExerciseId)
            .Select(g =>
            {
                var best = g.Select(s => OneRepMax(s, bodyWeightKg)).Where(x => x is not null).DefaultIfEmpty().Max();
                var heaviest = g.Select(s => Load(s, bodyWeightKg)).DefaultIfEmpty(0m).Max();
                var first = g.First();

                return new ExerciseListItemDto(
                    g.Key, first.ExerciseName, first.MuscleGroup, first.Modality,
                    g.Select(s => s.WorkoutId).Distinct().Count(),
                    g.Max(s => s.StartedAt),
                    best,
                    heaviest > 0 ? heaviest : null);
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

    private static List<WeekPointDto> Weekly(
        List<WorkoutRow> workouts, List<SetRow> sets, decimal? bodyWeightKg,
        DateOnly firstWeek, int weeks, int offsetMinutes)
    {
        var setsByWeek = sets
            .GroupBy(s => WeekStartOf(s.StartedAt, offsetMinutes))
            .ToDictionary(g => g.Key, g => (Volume: g.Sum(s => Volume(s, bodyWeightKg)), Sets: g.Count()));

        var workoutsByWeek = workouts
            .GroupBy(w => WeekStartOf(w.StartedAt, offsetMinutes))
            .ToDictionary(
                g => g.Key,
                g => (Count: g.Count(),
                      Seconds: g.Where(w => w.FinishedAt is not null)
                               .Sum(w => (int)(w.FinishedAt!.Value - w.StartedAt).TotalSeconds)));

        // Weeks with no training are emitted as zeroes rather than skipped: a gap in a volume chart
        // should be visible as a gap, not smoothed over by the next bar sliding left.
        var points = new List<WeekPointDto>(weeks);
        var volumes = new List<decimal>(weeks);

        for (var i = 0; i < weeks; i++)
        {
            var week = firstWeek.AddDays(7 * i);
            var s = setsByWeek.GetValueOrDefault(week);
            var w = workoutsByWeek.GetValueOrDefault(week);

            volumes.Add(s.Volume);
            var rolling = volumes.Skip(Math.Max(0, volumes.Count - 4)).Average();

            points.Add(new WeekPointDto(
                week, w.Count, Math.Round(s.Volume, 1), s.Sets, w.Seconds, Math.Round(rolling, 1)));
        }

        return points;
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

    private static List<StallingDto> Stalling(
        List<RecordDto> records, List<SetRow> history,
        Dictionary<Guid, (DateTimeOffset Last, int Sessions)> activity, DateTimeOffset now)
    {
        var bestByExercise = records
            .GroupBy(r => r.ExerciseId)
            .ToDictionary(g => g.Key, g => g.MaxBy(r => r.EstimatedOneRepMax)!);

        var result = new List<StallingDto>();

        foreach (var (exerciseId, record) in bestByExercise)
        {
            if (!activity.TryGetValue(exerciseId, out var a)) continue;

            // Only flag movements that are still part of training. An exercise you stopped doing
            // months ago is not stalled, it is retired, and belongs in the neglected list instead.
            if ((now - a.Last).TotalDays > NeglectedDays) continue;

            var weeksSince = (int)((now - record.AchievedAt).TotalDays / 7);
            if (weeksSince < StallWeeks) continue;

            var sessionsSince = history
                .Where(s => s.ExerciseId == exerciseId && s.StartedAt > record.AchievedAt)
                .Select(s => s.WorkoutId)
                .Distinct()
                .Count();

            // Needs a few attempts since the record before "stalled" is a fair description.
            if (sessionsSince < 3) continue;

            result.Add(new StallingDto(
                exerciseId, record.ExerciseName, record.EstimatedOneRepMax,
                record.AchievedAt, weeksSince, sessionsSince));
        }

        return [.. result.OrderByDescending(x => x.WeeksSinceBest).Take(8)];
    }

    /// <summary>Movements the user's own routines call for but that have quietly dropped out.</summary>
    private async Task<List<NeglectedDto>> NeglectedAsync(
        Guid userId, Dictionary<Guid, (DateTimeOffset Last, int Sessions)> activity,
        DateTimeOffset now, CancellationToken ct)
    {
        var planned = await db.RoutineExercises
            .Where(re => re.Routine.UserId == userId && !re.Routine.IsArchived && !re.Exercise.IsArchived)
            .Select(re => new { re.ExerciseId, Name = re.Exercise.Name, Routine = re.Routine.Name })
            .ToListAsync(ct);

        return [.. planned
            .DistinctBy(p => p.ExerciseId)
            .Select(p => new
            {
                p.ExerciseId,
                p.Name,
                p.Routine,
                Last = activity.TryGetValue(p.ExerciseId, out var a) ? a.Last : (DateTimeOffset?)null,
            })
            .Where(p => p.Last is null || (now - p.Last.Value).TotalDays >= NeglectedDays)
            .Select(p => new NeglectedDto(
                p.ExerciseId, p.Name,
                p.Last ?? DateTimeOffset.MinValue,
                p.Last is null ? int.MaxValue : (int)(now - p.Last.Value).TotalDays,
                p.Routine))
            .OrderByDescending(p => p.DaysSince)
            .Take(8)];
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
    /// Completed working sets in a window. Warm-ups are filtered out at the source, so no caller
    /// downstream has to remember to exclude them.
    /// </summary>
    private Task<List<SetRow>> WorkingSetsAsync(
        Guid userId, DateTimeOffset since, CancellationToken ct, Guid? exerciseId = null)
    {
        var query = db.Sets
            .Where(s => s.WorkoutExercise.Workout.UserId == userId
                        && s.WorkoutExercise.Workout.FinishedAt != null
                        && s.WorkoutExercise.Workout.StartedAt >= since
                        && s.IsCompleted
                        && !s.IsWarmup);

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
