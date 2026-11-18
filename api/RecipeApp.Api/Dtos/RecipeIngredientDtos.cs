using System.ComponentModel.DataAnnotations;

namespace RecipeApp.Api.Dtos;

//Client Sends
public record RecipeIngredientLineRequest(
    [Required, MaxLength(100)]string Name,
    [Range(0,100000)]decimal? Quantity,
    [MaxLength(50)]string? Unit,
    [MaxLength(200)]string? Note,
    [MaxLength(100)] string? Section);

//API Sends Back
public record RecipeIngredientLineDto(
    string Name,
    decimal? Quantity,
    string? Unit,
    string? Note,
    string? Section);
