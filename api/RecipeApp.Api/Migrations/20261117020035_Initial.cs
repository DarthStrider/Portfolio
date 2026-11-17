using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RecipeApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ingredients",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ingredients", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "recipes",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    servings = table.Column<int>(type: "integer", nullable: false),
                    prep_time = table.Column<int>(type: "integer", nullable: true),
                    cook_time = table.Column<int>(type: "integer", nullable: true),
                    source_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recipes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "recipe_ingredients",
                columns: table => new
                {
                    recipe_id = table.Column<int>(type: "integer", nullable: false),
                    ingredient_id = table.Column<int>(type: "integer", nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    unit = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recipe_ingredients", x => new { x.recipe_id, x.ingredient_id });
                    table.ForeignKey(
                        name: "fk_recipe_ingredients_ingredients_ingredient_id",
                        column: x => x.ingredient_id,
                        principalTable: "ingredients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_recipe_ingredients_recipes_recipe_id",
                        column: x => x.recipe_id,
                        principalTable: "recipes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "recipe_steps",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    recipe_id = table.Column<int>(type: "integer", nullable: false),
                    step_number = table.Column<int>(type: "integer", nullable: false),
                    text = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recipe_steps", x => x.id);
                    table.ForeignKey(
                        name: "fk_recipe_steps_recipes_recipe_id",
                        column: x => x.recipe_id,
                        principalTable: "recipes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ingredients_name",
                table: "ingredients",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_recipe_ingredients_ingredient_id",
                table: "recipe_ingredients",
                column: "ingredient_id");

            migrationBuilder.CreateIndex(
                name: "ix_recipe_steps_recipe_id_step_number",
                table: "recipe_steps",
                columns: new[] { "recipe_id", "step_number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "recipe_ingredients");

            migrationBuilder.DropTable(
                name: "recipe_steps");

            migrationBuilder.DropTable(
                name: "ingredients");

            migrationBuilder.DropTable(
                name: "recipes");
        }
    }
}
