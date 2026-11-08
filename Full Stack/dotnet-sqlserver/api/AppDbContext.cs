using Microsoft.EntityFrameworkCore;

namespace TaskApi;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
}
