using System.Security.Cryptography;
using System.Text;
using RepTracker.Api.Config;

namespace RepTracker.Api.Auth;

/// <summary>Turns secrets into the fixed-size digests we are willing to keep in the database.</summary>
public class Tokens(AppOptions options)
{
    private readonly byte[] _pepper = Encoding.UTF8.GetBytes(options.LoginPepper);

    /// <summary>
    /// Keyed digest of a login code. Keyed rather than salted so login stays a single indexed lookup,
    /// and so a stolen database cannot be brute-forced offline without also stealing the pepper.
    /// </summary>
    public byte[] HashLoginCode(string normalizedCode) =>
        HMACSHA256.HashData(_pepper, Encoding.UTF8.GetBytes(normalizedCode));

    /// <summary>A fresh opaque session token and the digest to store against it.</summary>
    public static (string Token, byte[] Hash) NewSessionToken()
    {
        var raw = RandomNumberGenerator.GetBytes(32);
        var token = Base64UrlEncode(raw);
        return (token, SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    }

    public static byte[] HashSessionToken(string token) =>
        SHA256.HashData(Encoding.UTF8.GetBytes(token));

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
