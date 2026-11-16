using System.ComponentModel.DataAnnotations;

namespace RecipeApp.Api.Dtos;

//Client Sends
public record RecipeStepLineRequest(
    [Required, MaxLength(1000)]string Text);

//API Sends Back
public record RecipeStepLineDto(
    int StepNumber,
    string Text);