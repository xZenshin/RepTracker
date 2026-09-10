using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;

namespace RepTracker.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuth(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/register", Register).RequireRateLimiting(RateLimits.Register);
        group.MapPost("/login", Login).RequireRateLimiting(RateLimits.Login);
        group.MapPost("/logout", Logout).RequireAuthorization();
        group.MapGet("/me", Me).RequireAuthorization();
        group.MapPatch("/me", UpdateMe).RequireAuthorization();
        group.MapDelete("/me", DeleteMe).RequireAuthorization();
    }

    private static async Task<IResult> Register(
        RegisterRequest? body, AppDb db, Tokens tokens, AppOptions options, HttpContext ctx, CancellationToken ct)
    {
        // An optional shared secret turns a public sign-up form into an invite-only one, which is
        // the cheapest way to keep a personally-funded instance to people you actually know.
        if (!string.IsNullOrEmpty(options.SignupCode) && body?.SignupCode?.Trim() != options.SignupCode)
            return Results.Problem(detail: "A valid signup code is required.", statusCode: StatusCodes.Status403Forbidden);

        // A hard ceiling on rows, independent of how patient an attacker is willing to be.
        if (await db.Users.CountAsync(ct) >= options.MaxAccounts)
            return Results.Problem(
                detail: "This instance is not accepting new accounts.",
                statusCode: StatusCodes.Status403Forbidden);

        var code = LoginCode.Generate();
        var now = DateTimeOffset.UtcNow;

        var user = new User
        {
            Id = Guid.CreateVersion7(),
            LoginCodeHmac = tokens.HashLoginCode(code),
            DisplayName = Validation.Text(body?.DisplayName, 40),
            CreatedAt = now,
            LastSeenAt = now,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        await IssueSessionAsync(db, ctx, user.Id, options, ct);

        // The only time this code is ever transmitted. It is not recoverable from the database.
        return Results.Ok(new RegisterResponse(code, LoginCode.Format(code), user.ToDto()));
    }

    private static async Task<IResult> Login(
        LoginRequest? body, AppDb db, Tokens tokens, AppOptions options, HttpContext ctx, CancellationToken ct)
    {
        var code = LoginCode.Normalize(body?.Code);

        // The check digit is computable by anyone, so rejecting here leaks nothing and saves the
        // database lookup. The rate limiter has already run by this point, so a typo still costs
        // an attempt; it is the browser's identical check that keeps typos from spending them.
        if (!LoginCode.IsWellFormed(code))
            return Results.Problem(detail: "That code is not valid.", statusCode: StatusCodes.Status401Unauthorized);

        var hash = tokens.HashLoginCode(code);
        var user = await db.Users.FirstOrDefaultAsync(u => u.LoginCodeHmac == hash, ct);

        if (user is null)
            return Results.Problem(detail: "That code is not valid.", statusCode: StatusCodes.Status401Unauthorized);

        user.LastSeenAt = DateTimeOffset.UtcNow;
        await IssueSessionAsync(db, ctx, user.Id, options, ct);

        return Results.Ok(user.ToDto());
    }

    private static async Task<IResult> Logout(AppDb db, HttpContext ctx, CancellationToken ct)
    {
        var token = ctx.Request.Cookies[SessionDefaults.Cookie];
        if (!string.IsNullOrEmpty(token))
        {
            var hash = Tokens.HashSessionToken(token);
            await db.Sessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct);
        }

        ctx.Response.Cookies.Delete(SessionDefaults.Cookie, CookieOptions(ctx, null));
        return Results.NoContent();
    }

    private static IResult Me(HttpContext ctx) => Results.Ok(ctx.CurrentUser().ToDto());

    private static async Task<IResult> UpdateMe(
        UpdateUserRequest body, AppDb db, HttpContext ctx, CancellationToken ct)
    {
        var user = ctx.CurrentUser();

        if (body.DisplayName is not null) user.DisplayName = Validation.Text(body.DisplayName, 40);
        if (body.Units is not null) user.Units = Validation.OneOf(body.Units, ["kg", "lb"], "kg");
        if (body.BodyWeightKg is not null) user.BodyWeightKg = Validation.BodyWeight(body.BodyWeightKg);

        await db.SaveChangesAsync(ct);
        return Results.Ok(user.ToDto());
    }

    private static async Task<IResult> DeleteMe(
        AppDb db, ClaimsPrincipal principal, HttpContext ctx, CancellationToken ct)
    {
        var userId = principal.UserId();

        // Workouts and their children cascade; the user's own exercises do not, because routines
        // and past workouts still point at them, so they are cleared in dependency order. One
        // transaction so a failure part-way cannot leave an account half-erased.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        await db.Workouts.Where(w => w.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Routines.Where(r => r.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Exercises.Where(e => e.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync(ct);

        await transaction.CommitAsync(ct);

        ctx.Response.Cookies.Delete(SessionDefaults.Cookie, CookieOptions(ctx, null));
        return Results.NoContent();
    }

    private static async Task IssueSessionAsync(
        AppDb db, HttpContext ctx, Guid userId, AppOptions options, CancellationToken ct)
    {
        var (token, hash) = Tokens.NewSessionToken();
        var now = DateTimeOffset.UtcNow;
        var expires = now.AddDays(options.SessionDays);

        db.Sessions.Add(new Session
        {
            Id = Guid.CreateVersion7(),
            UserId = userId,
            TokenHash = hash,
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = expires,
        });

        await db.SaveChangesAsync(ct);
        ctx.Response.Cookies.Append(SessionDefaults.Cookie, token, CookieOptions(ctx, expires));
    }

    private static CookieOptions CookieOptions(HttpContext ctx, DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        // Lax rather than Strict: the cookie still survives following a link into the app, and the
        // API is same-origin with the SPA, so there is no cross-site request to protect against.
        SameSite = SameSiteMode.Lax,
        Secure = ctx.Request.IsHttps,
        Path = "/",
        Expires = expires,
        IsEssential = true,
    };
}
