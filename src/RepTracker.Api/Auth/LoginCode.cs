using System.Security.Cryptography;
using System.Text;

namespace RepTracker.Api.Auth;

/// <summary>
/// The account's only credential: 19 cryptographically random digits plus a Luhn check digit.
/// That is ~2^63 of keyspace. The check digit catches a mistyped code in the browser before it
/// becomes a request at all - which is what keeps typos from spending the login rate limit - and
/// again on the server, where it rejects a bad code without a database lookup.
/// </summary>
public static class LoginCode
{
    public const int Digits = 20;

    public static string Generate()
    {
        var d = new int[Digits];
        for (var i = 0; i < Digits - 1; i++) d[i] = RandomNumberGenerator.GetInt32(0, 10);
        d[Digits - 1] = CheckDigit(d, Digits - 1);

        var sb = new StringBuilder(Digits);
        foreach (var x in d) sb.Append((char)('0' + x));
        return sb.ToString();
    }

    /// <summary>Strips spaces, dashes and any other separator a user may have pasted in.</summary>
    public static string Normalize(string? input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        var sb = new StringBuilder(input.Length);
        foreach (var c in input) if (c is >= '0' and <= '9') sb.Append(c);
        return sb.ToString();
    }

    public static bool IsWellFormed(string normalized)
    {
        if (normalized.Length != Digits) return false;
        var d = new int[Digits];
        for (var i = 0; i < Digits; i++) d[i] = normalized[i] - '0';
        return CheckDigit(d, Digits - 1) == d[Digits - 1];
    }

    /// <summary>Displays as 5 groups of 4, which is what makes a 20-digit string transcribable.</summary>
    public static string Format(string normalized) =>
        string.Join(' ', Enumerable.Range(0, normalized.Length / 4)
            .Select(i => normalized.Substring(i * 4, 4)));

    /// <summary>Luhn check digit over the first <paramref name="len"/> digits of <paramref name="d"/>.</summary>
    private static int CheckDigit(int[] d, int len)
    {
        var sum = 0;
        // Weighting alternates from the right, and the check digit itself occupies the rightmost slot.
        var doubleIt = true;
        for (var i = len - 1; i >= 0; i--)
        {
            var v = d[i];
            if (doubleIt) { v *= 2; if (v > 9) v -= 9; }
            sum += v;
            doubleIt = !doubleIt;
        }
        return (10 - sum % 10) % 10;
    }
}
