namespace RecipeApp.Api.Dtos;

//Client Sends
public record RecipeIngredientLineRequest(
    string Name,
    decimal? Quantity,
    string? Unit,
    string? Note);

//API Sends Back
public record RecipeIngredientLineDto(
    string Name,
    decimal? Quantity,
    string? Unit,
    string? Note);