using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepTracker.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SaveWorkoutsWhenFinished : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Workouts are now kept on the phone until finished, so the server no longer holds any in
            // progress. Close out the ones it does, the way the old Finish did: unticked sets and the
            // exercises left empty go, and a workout with nothing logged goes with them. One that
            // keeps something is finished at its last ticked set, so nothing logged is lost.
            migrationBuilder.Sql("""
                DELETE FROM "Sets" s
                USING "WorkoutExercises" we, "Workouts" w
                WHERE s."WorkoutExerciseId" = we."Id" AND we."WorkoutId" = w."Id"
                  AND w."FinishedAt" IS NULL AND NOT s."IsCompleted";

                DELETE FROM "WorkoutExercises" we
                USING "Workouts" w
                WHERE we."WorkoutId" = w."Id" AND w."FinishedAt" IS NULL
                  AND NOT EXISTS (SELECT 1 FROM "Sets" s WHERE s."WorkoutExerciseId" = we."Id");

                DELETE FROM "Workouts" w
                WHERE w."FinishedAt" IS NULL
                  AND NOT EXISTS (SELECT 1 FROM "WorkoutExercises" we WHERE we."WorkoutId" = w."Id");

                UPDATE "Workouts" w
                SET "FinishedAt" = COALESCE(
                    (SELECT MAX(s."CompletedAt") FROM "Sets" s
                     JOIN "WorkoutExercises" we ON we."Id" = s."WorkoutExerciseId"
                     WHERE we."WorkoutId" = w."Id"),
                    w."StartedAt")
                WHERE w."FinishedAt" IS NULL;
                """);

            migrationBuilder.DropIndex(
                name: "IX_Workouts_OneActivePerUser",
                table: "Workouts");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Workouts_OneActivePerUser",
                table: "Workouts",
                column: "UserId",
                unique: true,
                filter: "\"FinishedAt\" IS NULL");
        }
    }
}
