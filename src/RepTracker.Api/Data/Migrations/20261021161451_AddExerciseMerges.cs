using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepTracker.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddExerciseMerges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ExerciseMerges",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    FromExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    FromName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    IntoExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    MergedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseMerges", x => new { x.UserId, x.FromExerciseId });
                    table.ForeignKey(
                        name: "FK_ExerciseMerges_Exercises_IntoExerciseId",
                        column: x => x.IntoExerciseId,
                        principalTable: "Exercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ExerciseMerges_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseMerges_IntoExerciseId",
                table: "ExerciseMerges",
                column: "IntoExerciseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExerciseMerges");
        }
    }
}
