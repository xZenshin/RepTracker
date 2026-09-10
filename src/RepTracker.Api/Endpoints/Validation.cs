namespace RepTracker.Api.Endpoints;

/// <summary>
/// Input sanitising for a public API. Every free-text field is trimmed and truncated rather than
/// rejected where that is harmless, and every numeric field is clamped to a physically sensible
/// range, so no request can store a 10MB exercise name or a 900,000 kg squat.
/// </summary>
public static class Validation
{
    public static IResult Problem(string detail) =>
        Results.Problem(detail: detail, statusCode: StatusCodes.Status400BadRequest);

    /// <summary>Trimmed and truncated. Returns null for anything that is only whitespace.</summary>
    public static string? Text(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    public static decimal? Weight(decimal? kg) => Clamp(kg, 0m, 1000m, 2);
    public static decimal? Distance(decimal? metres) => Clamp(metres, 0m, 1_000_000m, 2);
    public static decimal? Rpe(decimal? rpe) => Clamp(rpe, 1m, 10m, 1);
    public static decimal? BodyWeight(decimal? kg) => Clamp(kg, 20m, 500m, 2);

    public static int? Reps(int? reps) => reps is null ? null : Math.Clamp(reps.Value, 0, 1000);
    public static int? Duration(int? seconds) => seconds is null ? null : Math.Clamp(seconds.Value, 0, 86_400);
    public static int Rest(int seconds) => Math.Clamp(seconds, 0, 3600);
    public static int TargetSets(int sets) => Math.Clamp(sets, 1, 50);
    public static int? TargetReps(int? reps) => reps is null ? null : Math.Clamp(reps.Value, 1, 1000);

    /// <summary>Clamps a list size request so a caller cannot ask for the whole table in one go.</summary>
    public static int PageSize(int? requested, int fallback = 25, int max = 100) =>
        Math.Clamp(requested ?? fallback, 1, max);

    public static int Weeks(int? requested, int fallback = 12, int max = 260) =>
        Math.Clamp(requested ?? fallback, 1, max);

    /// <summary>Constrains a free-text label to a known vocabulary, falling back rather than failing.</summary>
    public static string OneOf(string? value, IReadOnlyCollection<string> allowed, string fallback)
    {
        if (value is null) return fallback;
        var match = allowed.FirstOrDefault(a => string.Equals(a, value.Trim(), StringComparison.OrdinalIgnoreCase));
        return match ?? fallback;
    }

    private static decimal? Clamp(decimal? value, decimal min, decimal max, int decimals) =>
        value is null ? null : Math.Round(Math.Clamp(value.Value, min, max), decimals);

    public static readonly string[] Patterns = ["push", "pull", "legs", "core", "cardio", "other"];

    public static readonly string[] Equipment =
        ["Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight", "Kettlebell", "Band", "Other"];
}
