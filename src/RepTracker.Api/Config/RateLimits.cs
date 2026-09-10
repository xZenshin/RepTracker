using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using RepTracker.Api.Auth;

namespace RepTracker.Api.Config;

/// <summary>
/// Request-rate controls. The global limiter bounds what any one caller can cost the server;
/// the named policies protect the two endpoints that are attractive to attack from the outside.
/// </summary>
public static class RateLimits
{
    public const string Login = "login";
    public const string Register = "register";

    public static IServiceCollection AddAppRateLimiting(this IServiceCollection services) =>
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            // Tell well-behaved clients when to come back rather than leaving them to hammer.
            o.OnRejected = (ctx, ct) =>
            {
                if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    ctx.HttpContext.Response.Headers.RetryAfter =
                        ((int)retryAfter.TotalSeconds).ToString(NumberFormatInfo.InvariantInfo);
                }
                return ValueTask.CompletedTask;
            };

            // Signed-in traffic is partitioned per account and anonymous traffic per address, so one
            // noisy user cannot exhaust everyone else's budget.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
            {
                if (!ctx.Request.Path.StartsWithSegments("/api"))
                    return RateLimitPartition.GetNoLimiter("static");

                var userId = ctx.User.FindFirst(SessionDefaults.UserIdClaim)?.Value;

                return userId is not null
                    ? Window($"u:{userId}", permit: 240, seconds: 60)
                    : Window($"ip:{ClientKey(ctx)}", permit: 60, seconds: 60);
            });

            // Guessing a code is the only way into somebody else's data, so this is the tightest budget
            // in the app. Twenty digits with a check digit means a guess is hopeless at this rate.
            o.AddPolicy(Login, ctx => Window($"login:{ClientKey(ctx)}", permit: 8, seconds: 900));

            // Every registration is a permanent row on disk that nobody asked for.
            o.AddPolicy(Register, ctx => Window($"reg:{ClientKey(ctx)}", permit: 3, seconds: 3600));
        });

    private static RateLimitPartition<string> Window(string key, int permit, int seconds) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permit,
            Window = TimeSpan.FromSeconds(seconds),
            QueueLimit = 0,
        });

    /// <summary>
    /// The caller's address. This is only trustworthy because forwarded headers are accepted from
    /// configured proxies alone - otherwise anyone could set X-Forwarded-For and reset their budget.
    /// </summary>
    private static string ClientKey(HttpContext ctx) =>
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}
