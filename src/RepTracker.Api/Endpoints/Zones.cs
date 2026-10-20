namespace RepTracker.Api.Endpoints;

public static class Zones
{
    /// <summary>
    /// The browser's named zone, so each date converts with its own daylight-saving offset; failing
    /// that, today's offset. Used where whole dates cross the wire, by the CSV import and export.
    /// </summary>
    public static TimeZoneInfo FromClient(string? id, int? offsetMinutes)
    {
        if (id is { Length: > 0 and <= 64 } && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone)) return zone;

        var offset = TimeSpan.FromMinutes(Math.Clamp(offsetMinutes ?? 0, -840, 840));
        return TimeZoneInfo.CreateCustomTimeZone("client", offset, "client", "client");
    }
}
