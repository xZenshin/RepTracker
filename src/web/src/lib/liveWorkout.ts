import { useSyncExternalStore } from 'react'
import { useMe } from '../api/hooks'
import type { Exercise, PreviousPerformance, Routine, WorkoutExercise, WorkoutSet } from '../api/types'

/**
 * The workout in progress. It lives on the phone, not the server: every tap edits it here and the
 * screen moves at once, and only Finish sends it, whole. Kept in localStorage so a reload, a locked
 * screen or a closed tab picks up where it left off - on this device only.
 */
export interface LiveWorkout {
  /** The phone's own id, which the server keeps, so a save retried after a lost response is not stored twice. */
  id: string
  /** Whose it is. Another account signed in on the same phone does not see it. */
  userId: string
  name: string
  startedAt: string
  routineId: string | null
  exercises: WorkoutExercise[]
}

/** Last time's sets per exercise id, from GET /workouts/previous. */
export type LastTime = Record<string, PreviousPerformance>

/** The values a set row holds, as stored: kilograms, seconds, metres. */
export interface SetValues {
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
}

// The server's default per-account caps (AppOptions.Limits). Held here so a workout cannot grow
// past what the save would accept - finding out at Finish would be too late.
export const MAX_EXERCISES = 40
export const MAX_SETS = 40

/** Rest for an exercise added by hand, as the server has always defaulted it. */
const DEFAULT_REST = 120

// ---- the store ----

const KEY = 'rt.workout'
const listeners = new Set<() => void>()
/** Undefined until first read; null is "no workout". */
let current: LiveWorkout | null | undefined

function read(): LiveWorkout | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LiveWorkout) : null
  } catch {
    return null
  }
}

function snapshot(): LiveWorkout | null {
  if (current === undefined) current = read()
  return current
}

function publish(next: LiveWorkout | null) {
  current = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Private mode can refuse storage. The workout still runs for as long as the page is open.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Another tab of the app editing the same workout.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return
  current = read()
  listeners.forEach((listener) => listener())
})

/** The signed-in user's workout in progress, or null. */
export function useLiveWorkout(): LiveWorkout | null {
  const { data: me } = useMe()
  const workout = useSyncExternalStore(subscribe, snapshot)
  return workout && me && workout.userId === me.id ? workout : null
}

/** Opens a workout - unless one is already open, which a double tap on Start would otherwise replace. */
export function startLiveWorkout(workout: LiveWorkout) {
  const open = snapshot()
  if (!open || open.userId !== workout.userId) publish(workout)
}

export function editLiveWorkout(change: (workout: LiveWorkout) => LiveWorkout) {
  const open = snapshot()
  if (open) publish(change(open))
}

export function clearLiveWorkout() {
  publish(null)
}

// ---- building and editing ----

/**
 * A new workout, laid out from a routine if there is one. Each exercise opens on last time's sets,
 * unticked, so the numbers to match or beat are already there; one never done before gets the
 * routine's set count as empty rows - a clean first entry, not the routine's targets.
 */
export function newWorkout(
  userId: string, routine: Routine | undefined, lastTime: LastTime, catalogue: Exercise[],
): LiveWorkout {
  const byId = new Map(catalogue.map((exercise) => [exercise.id, exercise]))

  return {
    id: newId(),
    userId,
    name: routine?.name ?? 'Workout',
    startedAt: new Date().toISOString(),
    routineId: routine?.id ?? null,
    exercises: (routine?.exercises ?? [])
      .toSorted((a, b) => a.position - b.position)
      .slice(0, MAX_EXERCISES)
      .map((re, position) => ({
        id: newId(),
        exerciseId: re.exerciseId,
        exerciseName: re.exerciseName,
        muscleGroup: re.muscleGroup,
        equipment: byId.get(re.exerciseId)?.equipment ?? '',
        modality: re.modality,
        position,
        restSeconds: re.restSeconds,
        notes: re.notes,
        previous: lastTime[re.exerciseId] ?? null,
        sets: carryOver(lastTime[re.exerciseId], re.targetSets),
      })),
  }
}

/** Adds an exercise at the end, opening on last time's sets; a first attempt starts with no rows. */
export function addExercise(workout: LiveWorkout, exercise: Exercise, lastTime: LastTime, id: string): LiveWorkout {
  if (workout.exercises.length >= MAX_EXERCISES) return workout

  return withPositions({
    ...workout,
    exercises: [...workout.exercises, fromCatalogue(exercise, lastTime, id, DEFAULT_REST, 0)],
  })
}

/**
 * Trades an exercise for another mid-workout - the lat pulldown is taken, so pull-ups instead.
 *
 * Sets already done stay with the exercise they were done on: rewriting them as the substitute
 * would falsify its history and records. So with nothing done yet the exercise is replaced where it
 * stands, keeping its id; with some sets done, its unfinished sets are dropped and the substitute,
 * with id `substituteId`, goes in right after it. Either way the substitute opens on its own last
 * time's sets, or - never done before - on as many empty rows as the one it replaces had left.
 */
export function swapExercise(
  workout: LiveWorkout, weId: string, exercise: Exercise, lastTime: LastTime, substituteId: string,
): LiveWorkout {
  const index = workout.exercises.findIndex((we) => we.id === weId)
  const original = workout.exercises[index]
  if (!original || original.exerciseId === exercise.id) return workout

  const done = original.sets.filter((s) => s.isCompleted)
  const remaining = original.sets.length - done.length

  if (done.length === 0) {
    const replaced = fromCatalogue(exercise, lastTime, original.id, original.restSeconds, remaining)
    return withPositions({ ...workout, exercises: workout.exercises.with(index, replaced) })
  }

  if (workout.exercises.length >= MAX_EXERCISES) return workout

  const kept = { ...original, sets: done }
  const substitute = fromCatalogue(exercise, lastTime, substituteId, original.restSeconds, remaining)
  return withPositions({
    ...workout,
    exercises: workout.exercises.toSpliced(index, 1, kept, substitute),
  })
}

export function removeExercise(workout: LiveWorkout, weId: string): LiveWorkout {
  return withPositions({ ...workout, exercises: workout.exercises.filter((we) => we.id !== weId) })
}

export function setRest(workout: LiveWorkout, weId: string, restSeconds: number): LiveWorkout {
  return mapExercise(workout, weId, (we) => ({ ...we, restSeconds }))
}

/** Adds a set after the last one. `completed` ticks it in the same step, which is how a set is logged. */
export function addSet(workout: LiveWorkout, weId: string, values: SetValues, completed: boolean): LiveWorkout {
  return mapExercise(workout, weId, (we) => {
    if (we.sets.length >= MAX_SETS) return we
    const set: WorkoutSet = {
      ...emptySet(we.sets.length),
      ...values,
      isCompleted: completed,
      completedAt: completed ? new Date().toISOString() : null,
    }
    return { ...we, sets: [...we.sets, set] }
  })
}

export function updateSet(
  workout: LiveWorkout, weId: string, setId: string, values: SetValues & { isCompleted?: boolean },
): LiveWorkout {
  return mapExercise(workout, weId, (we) => ({
    ...we,
    sets: we.sets.map((set) => {
      if (set.id !== setId) return set
      const { isCompleted, ...rest } = values
      const next = { ...set, ...rest }
      // The completion stamp is what the rest timer keys off, so it marks when the set was ticked
      // rather than when the empty row happened to be laid out.
      if (isCompleted !== undefined && isCompleted !== set.isCompleted) {
        next.isCompleted = isCompleted
        next.completedAt = isCompleted ? new Date().toISOString() : null
      }
      return next
    }),
  }))
}

export function removeSet(workout: LiveWorkout, weId: string, setId: string): LiveWorkout {
  return mapExercise(workout, weId, (we) => ({
    ...we,
    // Renumbered so positions stay a dense 0..n-1 and sets can be labelled by index.
    sets: we.sets.filter((s) => s.id !== setId).map((s, position) => ({ ...s, position })),
  }))
}

/**
 * What Finish sends: completed sets only, since an unticked row was never done, and no exercise
 * left without any. A blank name falls back on the server to the routine's, or "Workout".
 */
export function toSaveRequest(workout: LiveWorkout, name: string, notes: string) {
  return {
    id: workout.id,
    name: name.trim() || null,
    notes: notes.trim() || null,
    startedAt: workout.startedAt,
    routineId: workout.routineId,
    exercises: workout.exercises
      .map((we) => ({
        exerciseId: we.exerciseId,
        restSeconds: we.restSeconds,
        notes: we.notes ?? null,
        sets: we.sets
          .filter((s) => s.isCompleted)
          .map((s) => ({
            weightKg: s.weightKg ?? null,
            reps: s.reps ?? null,
            durationSeconds: s.durationSeconds ?? null,
            distanceM: s.distanceM ?? null,
            rpe: s.rpe ?? null,
            completedAt: s.completedAt ?? null,
          })),
      }))
      .filter((we) => we.sets.length > 0),
  }
}

export type SaveWorkoutRequest = ReturnType<typeof toSaveRequest>

// ---- helpers ----

function fromCatalogue(
  exercise: Exercise, lastTime: LastTime, id: string, restSeconds: number, emptyCount: number,
): WorkoutExercise {
  return {
    id,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    muscleGroup: exercise.muscleGroup,
    equipment: exercise.equipment,
    modality: exercise.modality,
    position: 0,
    restSeconds,
    notes: null,
    previous: lastTime[exercise.id] ?? null,
    sets: carryOver(lastTime[exercise.id], emptyCount),
  }
}

/** Last time's sets, value for value and unticked, so nothing counts until it is done again; else `emptyCount` blank rows. */
function carryOver(previous: PreviousPerformance | undefined, emptyCount: number): WorkoutSet[] {
  const template: SetValues[] = previous?.sets ?? Array.from({ length: emptyCount }, () => ({}))

  return template.slice(0, MAX_SETS).map((s, position) => ({
    ...emptySet(position),
    weightKg: s.weightKg ?? null,
    reps: s.reps ?? null,
    durationSeconds: s.durationSeconds ?? null,
    distanceM: s.distanceM ?? null,
  }))
}

function emptySet(position: number): WorkoutSet {
  return {
    id: newId(),
    position,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceM: null,
    rpe: null,
    isCompleted: false,
    completedAt: null,
  }
}

function mapExercise(
  workout: LiveWorkout, weId: string, change: (we: WorkoutExercise) => WorkoutExercise,
): LiveWorkout {
  return { ...workout, exercises: workout.exercises.map((we) => (we.id === weId ? change(we) : we)) }
}

function withPositions(workout: LiveWorkout): LiveWorkout {
  return { ...workout, exercises: workout.exercises.map((we, position) => ({ ...we, position })) }
}

/**
 * A random v4 UUID. crypto.randomUUID exists only on secure origins, and a phone testing against a
 * dev server over the LAN is plain http, so it falls back to getRandomValues, which works anywhere.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
