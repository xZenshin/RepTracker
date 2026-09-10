using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using RepTracker.Api.Auth;
using RepTracker.Api.Config;
using RepTracker.Api.Data;
using RepTracker.Api.Endpoints;
using RepTracker.Api.Stats;

var builder = WebApplication.CreateBuilder(args);

// ---- configuration ----

var options = builder.Configuration.GetSection(AppOptions.SectionName).Get<AppOptions>() ?? new AppOptions();

if (string.IsNullOrWhiteSpace(options.LoginPepper))
{
    // Without the pepper every login code hash changes, which would lock out every existing account,
    // so production refuses to start rather than silently doing that.
    if (!builder.Environment.IsDevelopment())
        throw new InvalidOperationException(
            "App__LoginPepper must be set. Generate one with: openssl rand -base64 32");

    options.LoginPepper = "development-only-pepper-do-not-use-in-production";
}

builder.Services.AddSingleton(options);

// ---- data ----

builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(ConnectionString(builder.Configuration)));
builder.Services.AddScoped<Tokens>();
builder.Services.AddScoped<StatsService>();

// ---- http ----

builder.Services.AddAppRateLimiting();

builder.Services
    .AddAuthentication(SessionDefaults.Scheme)
    .AddScheme<AuthenticationSchemeOptions, SessionAuthHandler>(SessionDefaults.Scheme, null);

builder.Services.AddAuthorization();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    // Enums cross the wire as names, so the TypeScript client reads "WeightReps" rather than 0.
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// Nothing this API accepts is large. A tight cap makes oversized-payload attacks cheap to reject.
builder.WebHost.ConfigureKestrel(k =>
{
    k.Limits.MaxRequestBodySize = 64 * 1024;
    k.Limits.MaxRequestHeadersTotalSize = 16 * 1024;
    k.Limits.MaxConcurrentConnections = 200;
    k.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(60);
    k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
    k.AddServerHeader = false;
});

if (options.TrustProxyHeaders)
{
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        // The platform's proxy is the only hop, and its address is not known ahead of time. This is
        // safe only because the container is not reachable except through that proxy - if you expose
        // the port directly, leave App__TrustProxyHeaders unset or anyone can forge their own IP.
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Clear();
        o.ForwardLimit = 1;
    });
}

var app = builder.Build();

// ---- pipeline ----

if (options.TrustProxyHeaders) app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.Use(async (ctx, next) =>
{
    var headers = ctx.Response.Headers;
    headers["X-Content-Type-Options"] = "nosniff";
    headers["Referrer-Policy"] = "no-referrer";
    headers["X-Frame-Options"] = "DENY";
    headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), interest-cohort=()";

    // The app loads no third-party code and talks to no third-party host, so the policy can be
    // strict. Inline styles are permitted because React writes them via the style attribute.
    headers["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

    await next();
});

// Static assets are served before authentication runs, so a request for a stylesheet never costs
// a session lookup in the database. Only /api traffic reaches the auth handler.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Vite fingerprints everything under /assets, so those files can be cached hard. The
        // shell must not be, or a deploy would never reach anyone.
        var path = ctx.Context.Request.Path;
        ctx.Context.Response.Headers.CacheControl = path.StartsWithSegments("/assets")
            ? "public, max-age=31536000, immutable"
            : "no-cache";
    },
});

app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapAuth();
app.MapExercises();
app.MapRoutines();
app.MapWorkouts();
app.MapStats();

// Anything that is not an API route is the single-page app, so deep links such as
// /stats/<id> are served the shell and routed in the browser.
app.MapFallbackToFile("index.html");

// ---- startup ----

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    await db.Database.MigrateAsync();
    await Seeder.SeedCatalogAsync(db);
    await Seeder.PurgeExpiredSessionsAsync(db);

    // dotnet run -- seed-demo: fabricates a training history to look at the dashboard against.
    // Gated on Development because it backdates rows, which nothing reachable over HTTP can do.
    if (args.Contains("seed-demo"))
    {
        if (!app.Environment.IsDevelopment())
            throw new InvalidOperationException("seed-demo is only available in Development.");

        var tokens = scope.ServiceProvider.GetRequiredService<Tokens>();
        var demoCode = await DemoData.CreateAsync(db, tokens);
        Console.WriteLine($"\nDemo account created. Login code: {LoginCode.Format(demoCode)}\n");
        return;
    }
}

app.Run();

static string ConnectionString(IConfiguration configuration)
{
    var configured = configuration.GetConnectionString("Postgres");
    if (!string.IsNullOrWhiteSpace(configured)) return configured;

    // Most managed hosts hand out a postgres:// URL rather than a keyword connection string.
    var url = configuration["DATABASE_URL"];
    if (string.IsNullOrWhiteSpace(url))
        throw new InvalidOperationException("Set ConnectionStrings__Postgres or DATABASE_URL.");

    var uri = new Uri(url);
    var credentials = uri.UserInfo.Split(':', 2);

    return new Npgsql.NpgsqlConnectionStringBuilder
    {
        Host = uri.Host,
        Port = uri.IsDefaultPort ? 5432 : uri.Port,
        Database = uri.AbsolutePath.TrimStart('/'),
        Username = Uri.UnescapeDataString(credentials[0]),
        Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : "",
        SslMode = uri.Host is "localhost" or "127.0.0.1" ? Npgsql.SslMode.Disable : Npgsql.SslMode.Require,
    }.ConnectionString;
}
