import type { Workout, WorkoutTotals } from '../api/types'

/**
 * Recomputes a workout's totals from the sets currently on screen.
 *
 * The server sends totals with every workout, but during a live session set edits are written
 * straight into the cache to keep the row from flickering under your thumb - which leaves the
 * server's totals a step behind. Deriving them here keeps the header honest without a refetch
 * on every tap. The rules match Formulas.cs on the server: completed working sets only, and
 * bodyweight movements carry the lifter's own mass.
 */
export function computeTotals(workout: Workout, bodyWeightKg: number | null | undefined): WorkoutTotals {
  let volume = 0
  let sets = 0
  let reps = 0

  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (!set.isCompleted || set.isWarmup) continue

      sets++
      reps += set.reps ?? 0

      const load =
        exercise.modality === 'WeightReps'
          ? set.weightKg ?? 0
          : exercise.modality === 'BodyweightReps'
            ? (bodyWeightKg ?? 0) + (set.weightKg ?? 0)
            : 0

      volume += load * (set.reps ?? 0)
    }
  }

  const duration = workout.finishedAt
    ? Math.round((new Date(workout.finishedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000)
    : null

  return { volumeKg: Math.round(volume * 10) / 10, sets, reps, durationSeconds: duration }
}
