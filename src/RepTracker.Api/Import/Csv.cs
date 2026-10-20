using System.Text;

namespace RepTracker.Api.Import;

/// <summary>
/// A small RFC 4180 reader: quoted fields, doubled quotes inside them, line breaks inside quotes,
/// and CRLF or LF endings. It also guesses the separator, because a spreadsheet saved in a European
/// locale writes semicolons - the comma is taken by the decimal point.
/// </summary>
public static class Csv
{
    public sealed record Row(int Line, string[] Fields);

    /// <summary>Whichever of comma, semicolon or tab appears most in the first line, outside quotes.</summary>
    public static char DetectDelimiter(string text)
    {
        int comma = 0, semicolon = 0, tab = 0;
        var quoted = false;

        foreach (var c in text)
        {
            if (c == '"') quoted = !quoted;
            else if (!quoted && (c == '\n' || c == '\r')) break;
            else if (!quoted && c == ',') comma++;
            else if (!quoted && c == ';') semicolon++;
            else if (!quoted && c == '\t') tab++;
        }

        if (semicolon > comma && semicolon >= tab) return ';';
        if (tab > comma && tab > semicolon) return '\t';
        return ',';
    }

    /// <summary>Every record with the line it starts on. Blank lines are dropped.</summary>
    public static List<Row> Read(string text, char delimiter)
    {
        var rows = new List<Row>();
        var fields = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        var line = 1;
        var rowStart = 1;

        // A byte-order mark is what Excel puts at the front of "CSV UTF-8"; it is not part of the header.
        var i = text.Length > 0 && text[0] == '﻿' ? 1 : 0;

        void EndField()
        {
            fields.Add(field.ToString());
            field.Clear();
        }

        void EndRow()
        {
            EndField();
            if (fields.Any(f => f.Trim().Length > 0)) rows.Add(new Row(rowStart, [.. fields]));
            fields.Clear();
        }

        for (; i < text.Length; i++)
        {
            var c = text[i];

            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else
                {
                    if (c == '\n') line++;
                    field.Append(c);
                }
                continue;
            }

            if (c == '"' && field.Length == 0) quoted = true;
            else if (c == delimiter) EndField();
            else if (c == '\r' || c == '\n')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                EndRow();
                line++;
                rowStart = line;
            }
            else field.Append(c);
        }

        if (field.Length > 0 || fields.Count > 0) EndRow();
        return rows;
    }
}
