using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace RecipeApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "cuisine_id",
                table: "recipes",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "courses",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_courses", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "cuisines",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_cuisines", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "meals",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:IdentitySequenceOptions", "'1000', '1', '', '', 'False', '1'")
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_meals", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "recipe_courses",
                columns: table => new
                {
                    recipe_id = table.Column<int>(type: "integer", nullable: false),
                    course_id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recipe_courses", x => new { x.recipe_id, x.course_id });
                    table.ForeignKey(
                        name: "fk_recipe_courses_courses_course_id",
                        column: x => x.course_id,
                        principalTable: "courses",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_recipe_courses_recipes_recipe_id",
                        column: x => x.recipe_id,
                        principalTable: "recipes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "recipe_meals",
                columns: table => new
                {
                    recipe_id = table.Column<int>(type: "integer", nullable: false),
                    meal_id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recipe_meals", x => new { x.recipe_id, x.meal_id });
                    table.ForeignKey(
                        name: "fk_recipe_meals_meals_meal_id",
                        column: x => x.meal_id,
                        principalTable: "meals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_recipe_meals_recipes_recipe_id",
                        column: x => x.recipe_id,
                        principalTable: "recipes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "courses",
                columns: new[] { "id", "name" },
                values: new object[,]
                {
                    { 1, "Appetizer" },
                    { 2, "Main" },
                    { 3, "Side" },
                    { 4, "Soup" },
                    { 5, "Salad" },
                    { 6, "Dessert" },
                    { 7, "Drink" }
                });

            migrationBuilder.InsertData(
                table: "cuisines",
                columns: new[] { "id", "name" },
                values: new object[,]
                {
                    { 1, "Italian" },
                    { 2, "Mexican" },
                    { 3, "Indian" },
                    { 4, "Japanese" },
                    { 5, "Chinese" },
                    { 6, "Greek" },
                    { 7, "Middle Eastern" },
                    { 8, "Canadian" },
                    { 9, "American" }
                });

            migrationBuilder.InsertData(
                table: "meals",
                columns: new[] { "id", "name" },
                values: new object[,]
                {
                    { 1, "Breakfast" },
                    { 2, "Brunch" },
                    { 3, "Lunch" },
                    { 4, "Dinner" },
                    { 5, "Snack" }
                });

            migrationBuilder.CreateIndex(
                name: "ix_recipes_cuisine_id",
                table: "recipes",
                column: "cuisine_id");

            migrationBuilder.CreateIndex(
                name: "ix_courses_name",
                table: "courses",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_cuisines_name",
                table: "cuisines",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_meals_name",
                table: "meals",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_recipe_courses_course_id",
                table: "recipe_courses",
                column: "course_id");

            migrationBuilder.CreateIndex(
                name: "ix_recipe_meals_meal_id",
                table: "recipe_meals",
                column: "meal_id");

            migrationBuilder.AddForeignKey(
                name: "fk_recipes_cuisines_cuisine_id",
                table: "recipes",
                column: "cuisine_id",
                principalTable: "cuisines",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_recipes_cuisines_cuisine_id",
                table: "recipes");

            migrationBuilder.DropTable(
                name: "cuisines");

            migrationBuilder.DropTable(
                name: "recipe_courses");

            migrationBuilder.DropTable(
                name: "recipe_meals");

            migrationBuilder.DropTable(
                name: "courses");

            migrationBuilder.DropTable(
                name: "meals");

            migrationBuilder.DropIndex(
                name: "ix_recipes_cuisine_id",
                table: "recipes");

            migrationBuilder.DropColumn(
                name: "cuisine_id",
                table: "recipes");
        }
    }
}
