using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace RecipeApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIngredientDensities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ingredient_densities",
                columns: table => new
                {
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    grams_per_cup = table.Column<decimal>(type: "numeric(6,1)", precision: 6, scale: 1, nullable: false),
                    prefer_weight = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ingredient_densities", x => x.name);
                });

            migrationBuilder.InsertData(
                table: "ingredient_densities",
                columns: new[] { "name", "grams_per_cup", "prefer_weight" },
                values: new object[,]
                {
                    { "all-purpose flour", 125m, true },
                    { "bread flour", 130m, true },
                    { "brown sugar", 220m, true },
                    { "butter", 227m, true },
                    { "chickpeas", 164m, true },
                    { "chocolate chips", 170m, true },
                    { "cocoa powder", 85m, true },
                    { "flour", 125m, true },
                    { "grated parmesan", 100m, true },
                    { "heavy cream", 240m, false },
                    { "honey", 340m, false },
                    { "icing sugar", 120m, true },
                    { "maple syrup", 315m, false },
                    { "milk", 245m, false },
                    { "olive oil", 216m, false },
                    { "peanut butter", 258m, true },
                    { "rice", 185m, true },
                    { "rolled oats", 90m, true },
                    { "sugar", 200m, true },
                    { "tahini", 240m, true },
                    { "vegetable oil", 218m, false },
                    { "water", 237m, false },
                    { "whole wheat flour", 120m, true },
                    { "yogurt", 245m, false }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ingredient_densities");
        }
    }
}
