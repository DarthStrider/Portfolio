using AccessLog.Core.Model;

namespace Dashboard.Api;

public enum Outcome
{
    All,
    Granted,
    Denied,
    Status,
}

/// <summary>Turns the query string into Snack 2's EventQuery. Kept separate so it's easy to test.</summary>
public static class Filters
{
    public static bool TryParseOutcome(string? text, out Outcome outcome)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            outcome = Outcome.All;
            return true;
        }
        return Enum.TryParse(text, ignoreCase: true, out outcome) && Enum.IsDefined(outcome);
    }

    public static EventQuery ToQuery(Outcome outcome, string? search, int limit) => new()
    {
        Text = string.IsNullOrWhiteSpace(search) ? null : search.Trim(),
        Kind = outcome switch
        {
            Outcome.Granted or Outcome.Denied => EventKind.BadgeSwipe,
            Outcome.Status => EventKind.StatusChange,
            _ => null,
        },
        Granted = outcome switch
        {
            Outcome.Granted => true,
            Outcome.Denied => false,
            _ => null,
        },
        Limit = limit,
    };
}
