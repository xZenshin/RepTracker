using System.Text;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;
using RepTracker.Api.Import;

namespace RepTracker.Api.Endpoints;

public static class ExportEndpoints
{
    public static void MapExport(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/export").RequireAuthorization();

        group.MapGet("/workouts", Workouts).RequireRateLimiting(RateLimits.Export);
    }

    /// <summary>
    /// Every finished workout as a CSV download, oldest first, in the format the import reads. Only
    /// completed sets are written: an unticked row was never done. Weights are in the user's units,
    /// and times in their zone, so the file reads the way the app shows it.
    /// </summary>
    private static async Task<IResult> Workouts(
        HttpContext ctx, AppDb db, CancellationToken ct, string? timeZone = null, int? offsetMinutes = null)
    {
        var user = ctx.CurrentUser();
        var zone = Zones.FromClient(timeZone, offsetMinutes);

        var workouts = await db.Workouts
            .Where(w => w.UserId == user.Id && w.FinishedAt != null)
            .OrderBy(w => w.StartedAt)
            .Select(w => new
            {
                w.StartedAt,
                Exercises = w.Exercises
                    .OrderBy(we => we.Position)
                    .Select(we => new
                    {
                        we.Exercise.Name,
                        we.Notes,
                        Sets = we.Sets
                            .Where(s => s.IsCompleted)
                            .OrderBy(s => s.Position)
                            .Select(s => new WorkoutCsvExport.Set(s.Reps, s.WeightKg, s.DurationSeconds, s.DistanceM))
                            .ToList(),
                    })
                    .ToList(),
            })
            .AsSplitQuery()
            .ToListAsync(ct);

        var csv = WorkoutCsvExport.Write(
            workouts.Select(w => new WorkoutCsvExport.Workout(
                w.StartedAt,
                [.. w.Exercises
                    .Where(e => e.Sets.Count > 0)
                    .Select(e => new WorkoutCsvExport.Exercise(e.Name, e.Notes, e.Sets))])),
            user.Units,
            zone);

        // A byte-order mark so Excel reads the file as UTF-8 and keeps letters like æ, ø and å; the
        // importer skips it.
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).DateTime);

        ctx.Response.Headers.CacheControl = "no-store";
        return Results.File(bytes, "text/csv; charset=utf-8", $"reptracker-export-{today:yyyy-MM-dd}.csv");
    }
}
