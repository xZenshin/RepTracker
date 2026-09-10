import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useActiveWorkout, useAddSet, useAddWorkoutExercise, useDeleteSet, useDeleteWorkout,
  useMe, useRemoveWorkoutExercise, useUpdateSet, useUpdateWorkout, useUpdateWorkoutExercise,
} from '../api/hooks'
import type { Modality, PreviousSet, Units, Workout, WorkoutExercise, WorkoutSet } from '../api/types'
import { ApiError } from '../api/client'
import { formatVolume, formatWeight, toDisplay, toKg } from '../lib/units'
import { formatDuration, formatRelative } from '../lib/time'
import { useElapsed } from '../lib/useElapsed'
import { computeTotals } from '../lib/totals'
import { useRestTimer } from '../lib/useRestTimer'
import ExercisePicker from '../components/ExercisePicker'
import Sheet from '../components/Sheet'
import { CheckIcon, PlusIcon, TimerIcon, TrashIcon } from '../components/Icons'
import './workout.css'

export default function ActiveWorkout() {
  const navigate = useNavigate()
  const { data: workout, isPending } = useActiveWorkout()
  const { data: user } = useMe()
  const rest = useRestTimer()
  const [picking, setPicking] = useState(false)
  const [finishing, setFinishing] = useState(false)

  const addExercise = useAddWorkoutExercise(workout?.id ?? '')

  useEffect(() => {
    if (!isPending && !workout) navigate('/', { replace: true })
  }, [isPending, workout, navigate])

  if (isPending) {
    return (
      <main className="page">
        <div className="skeleton" style={{ height: 90, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </main>
    )
  }

  if (!workout) return null

  const units = user?.units ?? 'kg'
  const used = new Set(workout.exercises.map((we) => we.exerciseId))

  return (
    <main className="page workout-page">
      <WorkoutHeader
        workout={workout}
        units={units}
        bodyWeightKg={user?.bodyWeightKg}
        onFinish={() => setFinishing(true)}
      />

      {workout.exercises.length === 0 ? (
        <div className="card empty">
          <h3>Empty workout</h3>
          <p className="small">Add the first exercise to get going.</p>
        </div>
      ) : (
        workout.exercises.map((we) => (
          <ExerciseBlock
            key={we.id}
            workoutId={workout.id}
            exercise={we}
            units={units}
            onRested={(seconds) => rest.start(seconds)}
          />
        ))
      )}

      <button className="btn block add-exercise" type="button" onClick={() => setPicking(true)}>
        <PlusIcon className="icon-sm" />
        Add exercise
      </button>

      {picking ? (
        <ExercisePicker
          usedIds={used}
          onClose={() => setPicking(false)}
          onPick={(exercise) => {
            addExercise.mutate(exercise.id)
            setPicking(false)
          }}
        />
      ) : null}

      {finishing ? (
        <FinishSheet
          workout={workout}
          units={units}
          bodyWeightKg={user?.bodyWeightKg}
          onClose={() => setFinishing(false)}
        />
      ) : null}

      <RestBar timer={rest} />
    </main>
  )
}

function WorkoutHeader({
  workout, units, bodyWeightKg, onFinish,
}: {
  workout: Workout
  units: Units
  bodyWeightKg: number | null | undefined
  onFinish: () => void
}) {
  const elapsed = useElapsed(workout.startedAt)
  const update = useUpdateWorkout()
  const [name, setName] = useState(workout.name)
  const totals = computeTotals(workout, bodyWeightKg)

  return (
    <header className="workout-header">
      <input
        className="workout-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const trimmed = name.trim()
          if (trimmed && trimmed !== workout.name) update.mutate({ id: workout.id, name: trimmed })
          else if (!trimmed) setName(workout.name)
        }}
        maxLength={60}
        aria-label="Workout name"
      />

      <div className="workout-stats">
        <span className="stat">
          <TimerIcon className="icon-sm" />
          <b className="tabular">{formatDuration(elapsed)}</b>
        </span>
        <span className="stat">
          <b className="tabular">{totals.sets}</b> {totals.sets === 1 ? 'set' : 'sets'}
        </span>
        <span className="stat">
          <b className="tabular">{formatVolume(totals.volumeKg, units)}</b>
        </span>
        <button className="btn primary sm" type="button" onClick={onFinish}>
          Finish
        </button>
      </div>
    </header>
  )
}

function ExerciseBlock({
  workoutId, exercise, units, onRested,
}: {
  workoutId: string
  exercise: WorkoutExercise
  units: Units
  onRested: (seconds: number) => void
}) {
  const addSet = useAddSet(workoutId)
  const removeExercise = useRemoveWorkoutExercise(workoutId)
  const updateExercise = useUpdateWorkoutExercise(workoutId)
  const [menuOpen, setMenuOpen] = useState(false)

  const previous = exercise.previous
  const lastSet = exercise.sets.at(-1)

  return (
    <section className="exercise-block">
      <header>
        <div className="titles">
          <h2>{exercise.exerciseName}</h2>
          <p className="faint small">
            {previous
              ? `Last time ${formatRelative(previous.performedAt)} - ${summarisePrevious(previous.sets, units)}`
              : 'First time logging this'}
          </p>
        </div>
        <button className="btn ghost sm" type="button" onClick={() => setMenuOpen(true)} aria-label="Exercise options">
          &#8943;
        </button>
      </header>

      <div className="set-grid" role="table">
        <div className="set-head" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader">Previous</span>
          <span role="columnheader">{primaryLabel(exercise.modality, units)}</span>
          <span role="columnheader">{secondaryLabel(exercise.modality)}</span>
          <span role="columnheader" aria-label="Done" />
        </div>

        {exercise.sets.map((set, index) => (
          <SetRow
            key={set.id}
            workoutId={workoutId}
            weId={exercise.id}
            set={set}
            index={index}
            modality={exercise.modality}
            units={units}
            previous={previous?.sets[index]}
            onCompleted={() => onRested(exercise.restSeconds)}
          />
        ))}
      </div>

      <button
        className="btn sm block add-set"
        type="button"
        disabled={addSet.isPending}
        onClick={() =>
          // Carrying the last set forward is the common case: same weight, same target reps.
          addSet.mutate({
            weId: exercise.id,
            weightKg: lastSet?.weightKg ?? null,
            reps: lastSet?.reps ?? null,
            durationSeconds: lastSet?.durationSeconds ?? null,
            distanceM: lastSet?.distanceM ?? null,
          })
        }
      >
        <PlusIcon className="icon-sm" />
        Add set
      </button>

      {menuOpen ? (
        <Sheet title={exercise.exerciseName} onClose={() => setMenuOpen(false)}>
          <label className="field">
            <span className="label">Rest between sets</span>
            <select
              className="select"
              value={exercise.restSeconds}
              onChange={(event) => {
                updateExercise.mutate({ weId: exercise.id, restSeconds: Number(event.target.value) })
              }}
            >
              {[0, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds === 0 ? 'No timer' : formatDuration(seconds)}
                </option>
              ))}
            </select>
          </label>

          <button
            className="btn danger block"
            type="button"
            onClick={() => {
              if (confirm(`Remove ${exercise.exerciseName} and its sets from this workout?`)) {
                removeExercise.mutate(exercise.id)
                setMenuOpen(false)
              }
            }}
          >
            <TrashIcon className="icon-sm" />
            Remove from workout
          </button>
        </Sheet>
      ) : null}
    </section>
  )
}

function SetRow({
  workoutId, weId, set, index, modality, units, previous, onCompleted,
}: {
  workoutId: string
  weId: string
  set: WorkoutSet
  index: number
  modality: Modality
  units: Units
  previous?: PreviousSet
  onCompleted: () => void
}) {
  const update = useUpdateSet(workoutId)
  const remove = useDeleteSet(workoutId)

  // Held locally while typing so the field never fights the cache mid-keystroke; committed on blur.
  const [primary, setPrimary] = useState(() => primaryValue(set, modality, units))
  const [secondary, setSecondary] = useState(() => secondaryValue(set, modality))

  useEffect(() => {
    setPrimary(primaryValue(set, modality, units))
    setSecondary(secondaryValue(set, modality))
    // Re-syncs when the server view of this set changes, e.g. after prefilling from "previous".
  }, [set.id, set.weightKg, set.reps, set.durationSeconds, set.distanceM, modality, units])

  function commit(extra?: { isCompleted?: boolean }) {
    const payload = { weId, setId: set.id, ...parseInputs(primary, secondary, modality, units), ...extra }
    update.mutate(payload)
  }

  function toggleComplete() {
    const next = !set.isCompleted
    commit({ isCompleted: next })
    if (next) onCompleted()
  }

  const previousText = previous ? describePrevious(previous, modality, units) : '-'

  return (
    <div className={`set-row${set.isCompleted ? ' done' : ''}${set.isWarmup ? ' warmup' : ''}`} role="row">
      <button
        className="set-index"
        type="button"
        onClick={() => update.mutate({ weId, setId: set.id, isWarmup: !set.isWarmup })}
        title={set.isWarmup ? 'Warm-up set - tap to make it a working set' : 'Tap to mark as a warm-up'}
      >
        {set.isWarmup ? 'W' : index + 1}
      </button>

      <button
        className="set-previous tabular"
        type="button"
        disabled={!previous}
        title={previous ? 'Tap to copy last time' : undefined}
        onClick={() => {
          if (!previous) return
          setPrimary(primaryValue(previous as WorkoutSet, modality, units))
          setSecondary(secondaryValue(previous as WorkoutSet, modality))
        }}
      >
        {previousText}
      </button>

      <input
        className="set-input tabular"
        value={primary}
        onChange={(event) => setPrimary(event.target.value)}
        onBlur={() => commit()}
        inputMode={modality === 'Duration' ? 'text' : 'decimal'}
        placeholder={previous ? String(primaryValue(previous as WorkoutSet, modality, units)) : '-'}
        aria-label={primaryLabel(modality, units)}
      />

      <input
        className="set-input tabular"
        value={secondary}
        onChange={(event) => setSecondary(event.target.value)}
        onBlur={() => commit()}
        inputMode={modality === 'DistanceDuration' ? 'text' : 'numeric'}
        placeholder={previous ? String(secondaryValue(previous as WorkoutSet, modality)) : '-'}
        aria-label={secondaryLabel(modality)}
      />

      <button
        className="set-check"
        type="button"
        onClick={toggleComplete}
        aria-pressed={set.isCompleted}
        aria-label={set.isCompleted ? `Set ${index + 1} done` : `Mark set ${index + 1} done`}
      >
        <CheckIcon />
      </button>

      <button
        className="set-delete"
        type="button"
        onClick={() => remove.mutate({ weId, setId: set.id })}
        aria-label={`Delete set ${index + 1}`}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

function RestBar({ timer }: { timer: ReturnType<typeof useRestTimer> }) {
  if (timer.remaining === null) return null

  const total = timer.total ?? timer.remaining
  const progress = total > 0 ? 1 - timer.remaining / total : 1
  const over = timer.remaining === 0

  return (
    <div className={`rest-bar${over ? ' over' : ''}`} role="status" aria-live="polite">
      <div className="rest-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
      <div className="rest-content">
        <TimerIcon className="icon-sm" />
        <b className="tabular">{over ? 'Rest over' : formatDuration(timer.remaining)}</b>
        <span className="spacer" />
        <button className="btn ghost sm" type="button" onClick={() => timer.add(30)}>+30s</button>
        <button className="btn ghost sm" type="button" onClick={timer.stop}>Skip</button>
      </div>
    </div>
  )
}

function FinishSheet({
  workout, units, bodyWeightKg, onClose,
}: {
  workout: Workout
  units: Units
  bodyWeightKg: number | null | undefined
  onClose: () => void
}) {
  const navigate = useNavigate()
  const update = useUpdateWorkout()
  const remove = useDeleteWorkout()
  const [notes, setNotes] = useState(workout.notes ?? '')
  const totals = computeTotals(workout, bodyWeightKg)

  const emptySets = workout.exercises.reduce(
    (count, we) => count + we.sets.filter((s) => !s.isCompleted).length, 0,
  )

  return (
    <Sheet title="Finish workout" onClose={onClose}>
      <div className="finish-summary">
        <div><b className="tabular">{totals.sets}</b><span className="faint small">{totals.sets === 1 ? 'set' : 'sets'}</span></div>
        <div><b className="tabular">{totals.reps}</b><span className="faint small">reps</span></div>
        <div><b className="tabular">{formatVolume(totals.volumeKg, units)}</b><span className="faint small">volume</span></div>
      </div>

      {emptySets > 0 ? (
        <p className="banner info" style={{ marginBottom: 14 }}>
          {emptySets} set{emptySets === 1 ? '' : 's'} {emptySets === 1 ? 'was' : 'were'} never ticked
          off and will be discarded.
        </p>
      ) : null}

      <label className="field">
        <span className="label">Notes (optional)</span>
        <textarea
          className="textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="How did it feel? Anything to change next time?"
          maxLength={1000}
        />
      </label>

      {update.error ? <p className="banner">{(update.error as ApiError).message}</p> : null}

      <button
        className="btn primary lg block"
        type="button"
        disabled={update.isPending}
        onClick={() =>
          update.mutate(
            { id: workout.id, notes, finish: true },
            { onSuccess: () => navigate(`/history/${workout.id}`, { replace: true }) },
          )
        }
      >
        {update.isPending ? 'Saving...' : 'Finish and save'}
      </button>

      <button
        className="btn danger block"
        type="button"
        style={{ marginTop: 10 }}
        onClick={() => {
          if (confirm('Discard this workout completely? Everything logged in it is lost.')) {
            remove.mutate(workout.id, { onSuccess: () => navigate('/', { replace: true }) })
          }
        }}
      >
        Discard workout
      </button>
    </Sheet>
  )
}

// ---- modality-aware field plumbing ----
// Each exercise type puts different things in the two input columns, so labels, parsing and
// formatting all key off the modality rather than being hard-coded to weight and reps.

function primaryLabel(modality: Modality, units: Units) {
  if (modality === 'Duration') return 'Time'
  if (modality === 'DistanceDuration') return 'Distance (m)'
  if (modality === 'BodyweightReps') return `+${units}`
  return units
}

function secondaryLabel(modality: Modality) {
  if (modality === 'Duration') return 'Reps'
  if (modality === 'DistanceDuration') return 'Time'
  return 'Reps'
}

function primaryValue(set: Partial<WorkoutSet>, modality: Modality, units: Units): string {
  if (modality === 'Duration') return set.durationSeconds ? formatDuration(set.durationSeconds) : ''
  if (modality === 'DistanceDuration') return set.distanceM != null ? String(set.distanceM) : ''
  const display = toDisplay(set.weightKg, units)
  return display === null ? '' : String(Math.round(display * 100) / 100)
}

function secondaryValue(set: Partial<WorkoutSet>, modality: Modality): string {
  if (modality === 'Duration') return set.reps != null ? String(set.reps) : ''
  if (modality === 'DistanceDuration') return set.durationSeconds ? formatDuration(set.durationSeconds) : ''
  return set.reps != null ? String(set.reps) : ''
}

function parseInputs(primary: string, secondary: string, modality: Modality, units: Units) {
  if (modality === 'Duration') {
    return { durationSeconds: parseClock(primary), reps: parseInt10(secondary) }
  }
  if (modality === 'DistanceDuration') {
    return { distanceM: parseNumber(primary), durationSeconds: parseClock(secondary) }
  }
  return { weightKg: toKg(parseNumber(primary), units), reps: parseInt10(secondary) }
}

function describePrevious(previous: PreviousSet, modality: Modality, units: Units): string {
  if (modality === 'Duration') return formatDuration(previous.durationSeconds ?? 0)
  if (modality === 'DistanceDuration') {
    return `${previous.distanceM ?? 0}m / ${formatDuration(previous.durationSeconds ?? 0)}`
  }
  const weight = formatWeight(previous.weightKg, units, false)
  return `${weight} x ${previous.reps ?? 0}`
}

function summarisePrevious(sets: PreviousSet[], units: Units): string {
  const working = sets.filter((s) => !s.isWarmup)
  if (working.length === 0) return 'warm-up only'

  const top = working.reduce((best, s) => ((s.weightKg ?? 0) > (best.weightKg ?? 0) ? s : best))
  return `${working.length} sets, top ${formatWeight(top.weightKg, units, false)} x ${top.reps ?? 0}`
}

/** Accepts either "90" or "1:30" so a plank and a 20-minute row are both natural to enter. */
function parseClock(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p.trim()) || 0)
    return parts.reduce((total, part) => total * 60 + part, 0)
  }

  return parseInt10(trimmed)
}

function parseNumber(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() === '' || Number.isNaN(value) ? null : value
}

function parseInt10(text: string): number | null {
  const value = parseInt(text.trim(), 10)
  return Number.isNaN(value) ? null : value
}
