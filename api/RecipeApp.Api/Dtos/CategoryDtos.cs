namespace RecipeApp.Api.Dtos;

//One cuisine, meal or course
public record CategoryDto(int Id, string Name);

//API sends (GET /api/categories): every list the form and filter bar need, in one call
public record CategoriesDto(
    List<CategoryDto> Cuisines,
    List<CategoryDto> Meals,
    List<CategoryDto> Courses);
