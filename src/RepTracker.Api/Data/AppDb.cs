using Microsoft.EntityFrameworkCore;

namespace RepTracker.Api.Data;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Exercise> Exercises => Set<Exercise>();
    public DbSet<Routine> Routines => Set<Routine>();
    public DbSet<RoutineExercise> RoutineExercises => Set<RoutineExercise>();
    public DbSet<Workout> Workouts => Set<Workout>();
    public DbSet<WorkoutExercise> WorkoutExercises => Set<WorkoutExercise>();
    public DbSet<WorkoutSet> Sets => Set<WorkoutSet>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.LoginCodeHmac).IsUnique();
            e.Property(x => x.BodyWeightKg).HasPrecision(6, 2);
        });

        b.Entity<Session>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.ExpiresAt);
            e.HasOne(x => x.User).WithMany(x => x.Sessions)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Exercise>(e =>
        {
            // Case-insensitive uniqueness per owner. Postgres treats NULLs as distinct, so this does
            // not constrain the seeded global catalogue (UserId null) - that is guarded by the seeder.
            e.HasIndex(x => new { x.UserId, x.NameNormalized }).IsUnique();
            e.HasIndex(x => x.NameNormalized);
            e.HasOne(x => x.User).WithMany(x => x.Exercises)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Routine>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.IsArchived });
            e.HasOne(x => x.User).WithMany(x => x.Routines)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RoutineExercise>(e =>
        {
            e.HasIndex(x => new { x.RoutineId, x.Position });
            e.Property(x => x.TargetWeightKg).HasPrecision(7, 2);
            e.HasOne(x => x.Routine).WithMany(x => x.Exercises)
                .HasForeignKey(x => x.RoutineId).OnDelete(DeleteBehavior.Cascade);
            // Block deleting an exercise that a routine still references.
            e.HasOne(x => x.Exercise).WithMany()
                .HasForeignKey(x => x.ExerciseId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Workout>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.StartedAt });
            // At most one workout in progress per user, enforced by the database itself.
            e.HasIndex(x => x.UserId).IsUnique()
                .HasFilter("\"FinishedAt\" IS NULL")
                .HasDatabaseName("IX_Workouts_OneActivePerUser");
            e.HasOne(x => x.User).WithMany(x => x.Workouts)
                .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Routine).WithMany()
                .HasForeignKey(x => x.RoutineId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<WorkoutExercise>(e =>
        {
            e.HasIndex(x => new { x.WorkoutId, x.Position });
            e.HasIndex(x => x.ExerciseId);
            e.HasOne(x => x.Workout).WithMany(x => x.Exercises)
                .HasForeignKey(x => x.WorkoutId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Exercise).WithMany()
                .HasForeignKey(x => x.ExerciseId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<WorkoutSet>(e =>
        {
            e.HasIndex(x => new { x.WorkoutExerciseId, x.Position });
            e.Property(x => x.WeightKg).HasPrecision(7, 2);
            e.Property(x => x.DistanceM).HasPrecision(10, 2);
            e.Property(x => x.Rpe).HasPrecision(3, 1);
            e.HasOne(x => x.WorkoutExercise).WithMany(x => x.Sets)
                .HasForeignKey(x => x.WorkoutExerciseId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
