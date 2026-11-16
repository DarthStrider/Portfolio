namespace RecipeApp.Api.Dtos;

//Client Sends
public record RecipeStepLineRequest(
    string Text);

//API Sends Back
public record RecipeStepLineDto(
    int StepNumber,
    string Text);