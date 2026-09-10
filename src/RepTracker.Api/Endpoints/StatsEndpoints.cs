using System.Security.Claims;
using RepTracker.Api.Auth;
using RepTracker.Api.Stats;

namespace RepTracker.Api.Endpoints;

public static class StatsEndpoints
{
    public static void MapStats(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stats").RequireAuthorization();

        group.MapGet("/overview", Overview);
        group.MapGet("/calendar", Calendar);
        group.MapGet("/exercises", ExerciseList);
        group.MapGet("/exercises/{id:guid}", Exercise);
    }

    private static async Task<IResult> Overview(
        StatsService stats, HttpContext ctx, ClaimsPrincipal principal, CancellationToken ct,
        int? weeks = null, int? offsetMinutes = null)
    {
        var user = ctx.CurrentUser();
        return Results.Ok(await stats.OverviewAsync(
            user.Id, user.BodyWeightKg, Validation.Weeks(weeks, 12), Offset(offsetMinutes), ct));
    }

    private static async Task<IResult> Calendar(
        StatsService stats, HttpContext ctx, CancellationToken ct,
        int? weeks = null, int? offsetMinutes = null)
    {
        var user = ctx.CurrentUser();
        return Results.Ok(await stats.CalendarAsync(
            user.Id, user.BodyWeightKg, Validation.Weeks(weeks, 53), Offset(offsetMinutes), ct));
    }

    private static async Task<IResult> ExerciseList(StatsService stats, HttpContext ctx, CancellationToken ct)
    {
        var user = ctx.CurrentUser();
        return Results.Ok(await stats.ExerciseListAsync(user.Id, user.BodyWeightKg, ct));
    }

    private static async Task<IResult> Exercise(
        Guid id, StatsService stats, HttpContext ctx, CancellationToken ct,
        int? weeks = null, int? offsetMinutes = null)
    {
        var user = ctx.CurrentUser();
        var result = await stats.ExerciseAsync(
            user.Id, id, user.BodyWeightKg, Validation.Weeks(weeks, 52), Offset(offsetMinutes), ct);

        return result is null ? Results.NotFound() : Results.Ok(result);
    }

    /// <summary>
    /// The browser's UTC offset in minutes, so weeks and days are bucketed by the user's own clock.
    /// Clamped to the range real time zones occupy.
    /// </summary>
    private static int Offset(int? minutes) => Math.Clamp(minutes ?? 0, -840, 840);
}
