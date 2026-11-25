using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RecipeApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOvenTemperature : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "oven_temperature",
                table: "recipes",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "oven_temperature_unit",
                table: "recipes",
                type: "character varying(1)",
                maxLength: 1,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "oven_temperature",
                table: "recipes");

            migrationBuilder.DropColumn(
                name: "oven_temperature_unit",
                table: "recipes");
        }
    }
}
