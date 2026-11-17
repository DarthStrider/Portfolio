using Microsoft.EntityFrameworkCore;
using RecipeApp.Api.Data;
using RecipeApp.Api.Services;
using Scalar.AspNetCore;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

//Register the DB
string connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Connection string 'Default' not found");

builder.Services.AddDbContext<AppDbContext>(
    options => options.UseNpgsql(connectionString)
    .UseSnakeCaseNamingConvention());

builder.Services.AddScoped<IRecipeService, RecipeService>();

WebApplication app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();

    //Apply migrations and seed sample data (development only)
    using IServiceScope scope = app.Services.CreateScope();
    AppDbContext db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    IRecipeService recipeService =scope.ServiceProvider.GetRequiredService<IRecipeService>();

    await db.Database.MigrateAsync();
    await SeedData.SeedAsync(db, recipeService);
}
else
{
    app.UseHttpsRedirection();
}

app.UseAuthorization();

app.MapControllers();

app.Run();
