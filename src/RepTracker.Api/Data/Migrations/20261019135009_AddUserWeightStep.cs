using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepTracker.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserWeightStep : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "WeightStepKg",
                table: "Users",
                type: "numeric(5,3)",
                precision: 5,
                scale: 3,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WeightStepKg",
                table: "Users");
        }
    }
}
