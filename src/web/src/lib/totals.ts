import type { Workout, WorkoutTotals } from '../api/types'

/**
 * A workout's totals from its sets.
 *
 * The server sends totals with every saved workout, but a workout in progress lives on the phone
 * and the server has never seen it, so these are worked out here. The rules match Formulas.cs on
 * the server: completed working sets only, and bodyweight movements carry the lifter's own mass.
 */
export function computeTotals(
  workout: Pick<Workout, 'exercises' | 'startedAt' | 'finishedAt'>,
  bodyWeightKg: number | null | undefined,
): WorkoutTotals {
  let volume = 0
  let sets = 0
  let reps = 0

  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (!set.isCompleted) continue

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
