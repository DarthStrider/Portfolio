using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RecipeApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIngredientSections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "pk_recipe_ingredients",
                table: "recipe_ingredients");

            migrationBuilder.AddColumn<int>(
                name: "id",
                table: "recipe_ingredients",
                type: "integer",
                nullable: false,
                defaultValue: 0)
                .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn);

            migrationBuilder.AddColumn<int>(
                name: "position",
                table: "recipe_ingredients",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "section",
                table: "recipe_ingredients",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "pk_recipe_ingredients",
                table: "recipe_ingredients",
                column: "id");

            migrationBuilder.CreateIndex(
                name: "ix_recipe_ingredients_recipe_id_section_ingredient_id",
                table: "recipe_ingredients",
                columns: new[] { "recipe_id", "section", "ingredient_id" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "pk_recipe_ingredients",
                table: "recipe_ingredients");

            migrationBuilder.DropIndex(
                name: "ix_recipe_ingredients_recipe_id_section_ingredient_id",
                table: "recipe_ingredients");

            migrationBuilder.DropColumn(
                name: "id",
                table: "recipe_ingredients");

            migrationBuilder.DropColumn(
                name: "position",
                table: "recipe_ingredients");

            migrationBuilder.DropColumn(
                name: "section",
                table: "recipe_ingredients");

            migrationBuilder.AddPrimaryKey(
                name: "pk_recipe_ingredients",
                table: "recipe_ingredients",
                columns: new[] { "recipe_id", "ingredient_id" });
        }
    }
}
