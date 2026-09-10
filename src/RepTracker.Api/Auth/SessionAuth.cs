using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RepTracker.Api.Data;

namespace RepTracker.Api.Auth;

public static class SessionDefaults
{
    public const string Scheme = "Session";
    public const string Cookie = "rt_session";
    public const string UserIdClaim = "uid";
}

/// <summary>
/// Resolves the opaque session cookie to a user. Sessions live in the database rather than in a
/// signed token so that logging out, or revoking every session, takes effect immediately.
/// </summary>
public class SessionAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> opts,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AppDb db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(opts, logger, encoder)
{
    /// <summary>How stale a session's last-seen stamp may get before we spend a write updating it.</summary>
    private static readonly TimeSpan LastSeenWriteInterval = TimeSpan.FromHours(6);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = Context.Request.Cookies[SessionDefaults.Cookie];
        if (string.IsNullOrEmpty(token)) return AuthenticateResult.NoResult();

        var hash = Tokens.HashSessionToken(token);
        var now = DateTimeOffset.UtcNow;

        var session = await db.Sessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.TokenHash == hash, Context.RequestAborted);

        if (session is null) return AuthenticateResult.Fail("Unknown session.");

        if (session.ExpiresAt <= now)
        {
            db.Sessions.Remove(session);
            await db.SaveChangesAsync(Context.RequestAborted);
            return AuthenticateResult.Fail("Session expired.");
        }

        if (now - session.LastSeenAt > LastSeenWriteInterval)
        {
            session.LastSeenAt = now;
            session.User.LastSeenAt = now;
            await db.SaveChangesAsync(Context.RequestAborted);
        }

        var identity = new ClaimsIdentity(
            [new Claim(SessionDefaults.UserIdClaim, session.UserId.ToString())],
            SessionDefaults.Scheme);

        Context.Items[nameof(User)] = session.User;

        return AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), SessionDefaults.Scheme));
    }

    // The API is consumed by fetch(), so answer with status codes rather than redirects to a login page.
    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }
}

public static class AuthExtensions
{
    /// <summary>The authenticated user's id. Only valid on endpoints behind RequireAuthorization().</summary>
    public static Guid UserId(this ClaimsPrincipal principal) =>
        Guid.Parse(principal.FindFirstValue(SessionDefaults.UserIdClaim)!);

    /// <summary>The already-loaded user entity, cached by the auth handler to avoid a second query.</summary>
    public static User CurrentUser(this HttpContext ctx) => (User)ctx.Items[nameof(User)]!;
}
