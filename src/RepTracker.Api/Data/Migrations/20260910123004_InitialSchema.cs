using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepTracker.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LoginCodeHmac = table.Column<byte[]>(type: "bytea", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Units = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    BodyWeightKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Exercises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    NameNormalized = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    MuscleGroup = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Equipment = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Modality = table.Column<int>(type: "integer", nullable: false),
                    Pattern = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Exercises", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Exercises_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Routines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Routines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Routines_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Sessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<byte[]>(type: "bytea", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Sessions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RoutineExercises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoutineId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    TargetSets = table.Column<int>(type: "integer", nullable: false),
                    TargetRepsMin = table.Column<int>(type: "integer", nullable: true),
                    TargetRepsMax = table.Column<int>(type: "integer", nullable: true),
                    TargetWeightKg = table.Column<decimal>(type: "numeric(7,2)", precision: 7, scale: 2, nullable: true),
                    RestSeconds = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoutineExercises", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RoutineExercises_Exercises_ExerciseId",
                        column: x => x.ExerciseId,
                        principalTable: "Exercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RoutineExercises_Routines_RoutineId",
                        column: x => x.RoutineId,
                        principalTable: "Routines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Workouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoutineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Workouts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Workouts_Routines_RoutineId",
                        column: x => x.RoutineId,
                        principalTable: "Routines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Workouts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutExercises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    RestSeconds = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutExercises", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkoutExercises_Exercises_ExerciseId",
                        column: x => x.ExerciseId,
                        principalTable: "Exercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkoutExercises_Workouts_WorkoutId",
                        column: x => x.WorkoutId,
                        principalTable: "Workouts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Sets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    WeightKg = table.Column<decimal>(type: "numeric(7,2)", precision: 7, scale: 2, nullable: true),
                    Reps = table.Column<int>(type: "integer", nullable: true),
                    DurationSeconds = table.Column<int>(type: "integer", nullable: true),
                    DistanceM = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    Rpe = table.Column<decimal>(type: "numeric(3,1)", precision: 3, scale: 1, nullable: true),
                    IsWarmup = table.Column<bool>(type: "boolean", nullable: false),
                    IsCompleted = table.Column<bool>(type: "boolean", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Sets_WorkoutExercises_WorkoutExerciseId",
                        column: x => x.WorkoutExerciseId,
                        principalTable: "WorkoutExercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_NameNormalized",
                table: "Exercises",
                column: "NameNormalized");

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_UserId_NameNormalized",
                table: "Exercises",
                columns: new[] { "UserId", "NameNormalized" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RoutineExercises_ExerciseId",
                table: "RoutineExercises",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_RoutineExercises_RoutineId_Position",
                table: "RoutineExercises",
                columns: new[] { "RoutineId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_Routines_UserId_IsArchived",
                table: "Routines",
                columns: new[] { "UserId", "IsArchived" });

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_ExpiresAt",
                table: "Sessions",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_TokenHash",
                table: "Sessions",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_UserId",
                table: "Sessions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Sets_WorkoutExerciseId_Position",
                table: "Sets",
                columns: new[] { "WorkoutExerciseId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_Users_LoginCodeHmac",
                table: "Users",
                column: "LoginCodeHmac",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExercises_ExerciseId",
                table: "WorkoutExercises",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExercises_WorkoutId_Position",
                table: "WorkoutExercises",
                columns: new[] { "WorkoutId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_OneActivePerUser",
                table: "Workouts",
                column: "UserId",
                unique: true,
                filter: "\"FinishedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_RoutineId",
                table: "Workouts",
                column: "RoutineId");

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_UserId_StartedAt",
                table: "Workouts",
                columns: new[] { "UserId", "StartedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RoutineExercises");

            migrationBuilder.DropTable(
                name: "Sessions");

            migrationBuilder.DropTable(
                name: "Sets");

            migrationBuilder.DropTable(
                name: "WorkoutExercises");

            migrationBuilder.DropTable(
                name: "Exercises");

            migrationBuilder.DropTable(
                name: "Workouts");

            migrationBuilder.DropTable(
                name: "Routines");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
