using System.ComponentModel.DataAnnotations;

namespace TaskApi;

public class TaskItem
{
    public int Id { get; set; }

    [MaxLength(200)]
    public required string Title { get; set; }

    public bool Done { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public record CreateTaskRequest(string? Title);

public record UpdateTaskRequest(string? Title, bool? Done);
