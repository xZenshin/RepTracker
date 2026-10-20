using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepTracker.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveWarmupSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsWarmup",
                table: "Sets");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsWarmup",
                table: "Sets",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
