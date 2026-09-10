namespace RepTracker.Api.Config;

/// <summary>
/// Everything tunable about cost and abuse in one place. Bound from the "App" configuration section,
/// so each of these is settable as an environment variable such as App__MaxAccounts.
/// </summary>
public class AppOptions
{
    public const string SectionName = "App";

    /// <summary>
    /// Secret key the login code is HMAC'd under. A database leak on its own is useless without this,
    /// so it must live outside the database. Required in production; a dev fallback is used otherwise.
    /// </summary>
    public string LoginPepper { get; set; } = "";

    /// <summary>Optional gate on registration. When set, callers must present it to create an account.</summary>
    public string? SignupCode { get; set; }

    /// <summary>Hard ceiling on accounts. The cheapest possible defence against someone filling the database.</summary>
    public int MaxAccounts { get; set; } = 50;

    /// <summary>Set when running behind a reverse proxy so client IPs come from X-Forwarded-For.</summary>
    public bool TrustProxyHeaders { get; set; }

    public int SessionDays { get; set; } = 60;

    public PerUserLimits Limits { get; set; } = new();

    /// <summary>
    /// Caps on how much one authenticated account can store. Rate limits slow an attacker down;
    /// these bound the total damage an account can do to disk.
    /// </summary>
    public class PerUserLimits
    {
        public int Workouts { get; set; } = 2000;
        public int ExercisesPerWorkout { get; set; } = 40;
        public int SetsPerExercise { get; set; } = 40;
        public int CustomExercises { get; set; } = 300;
        public int Routines { get; set; } = 60;
        public int ExercisesPerRoutine { get; set; } = 40;
    }
}
