using System.ComponentModel.DataAnnotations;

namespace TaskApi;

public class TaskItem
{
    public int Id { get; set; }

    [MaxLength(TaskRules.MaxTitleLength)]
    public required string Title { get; set; }

    public bool Done { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public record CreateTaskRequest(string? Title);

public record UpdateTaskRequest(string? Title, bool? Done);

public static class TaskRules
{
    public const int MaxTitleLength = 200;

    /// <summary>A title needs something other than spaces in it, and at most 200 characters.</summary>
    public static bool IsValidTitle(string? title) =>
        !string.IsNullOrWhiteSpace(title) && title.Length <= MaxTitleLength;
}
