import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useActiveWorkout, useAddSet, useAddWorkoutExercise, useDeleteSet, useDeleteWorkout,
  useMe, useRemoveWorkoutExercise, useUpdateSet, useUpdateWorkout, useUpdateWorkoutExercise,
} from '../api/hooks'
import type { Modality, PreviousSet, Units, Workout, WorkoutExercise, WorkoutSet } from '../api/types'
import { ApiError } from '../api/client'
import { formatVolume, formatWeight, toDisplay, toKg, weightStep } from '../lib/units'
import { formatDuration, formatRelative } from '../lib/time'
import { useElapsed } from '../lib/useElapsed'
import { computeTotals } from '../lib/totals'
import { useRestTimer } from '../lib/useRestTimer'
import ExercisePicker from '../components/ExercisePicker'
import Sheet from '../components/Sheet'
import {
  BackIcon, CheckIcon, ListIcon, MinusCircleIcon, MoreIcon, PlusCircleIcon, PlusIcon, SkipIcon,
  TimerIcon, TrashIcon,
} from '../components/Icons'
import './workout.css'

type RestTimer = ReturnType<typeof useRestTimer>
type OpenSheet = 'picker' | 'exercises' | 'menu' | 'finish' | null

// Which exercise is on screen. Kept in sessionStorage, like the rest timer, so a reload mid-workout
// lands back on the same exercise rather than jumping to the first unfinished one.
const CURRENT_KEY = 'rt.current-exercise'

/**
 * One exercise at a time, full screen: dial in the next set, tick it, rest, repeat - then move on.
 * Everything else (the other exercises, rest length, finishing) is one tap away in a sheet.
 */
export default function ActiveWorkout() {
  const navigate = useNavigate()
  const { data: workout, isPending } = useActiveWorkout()
  const { data: user } = useMe()
  const rest = useRestTimer()
  const [selectedId, setSelectedId] = useState<string | null>(readCurrent)
  const [sheet, setSheet] = useState<OpenSheet>(null)

  const addExercise = useAddWorkoutExercise(workout?.id ?? '')

  useEffect(() => {
    if (!isPending && !workout) navigate('/', { replace: true })
  }, [isPending, workout, navigate])

  if (isPending) {
    return (
      <main className="page workout-page">
        <div className="skeleton" style={{ height: 52, width: 52, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 40, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 230 }} />
      </main>
    )
  }

  if (!workout) return null

  const units = user?.units ?? 'kg'
  const exercises = workout.exercises
  // A stale id (removed exercise, or one from a previous workout) simply falls through.
  const current = exercises.find((we) => we.id === selectedId) ?? firstUnfinished(exercises)
  const index = current ? exercises.indexOf(current) : -1
  const next = exercises[index + 1]
  const prev = index > 0 ? exercises[index - 1] : undefined

  function pin(id: string) {
    setSelectedId(id)
    writeCurrent(id)
  }

  function select(id: string) {
    pin(id)
    window.scrollTo({ top: 0 })
  }

  return (
    <main className="page workout-page">
      <div className="focus-top">
        <button className="icon-btn" type="button" onClick={() => navigate('/')} aria-label="Back to Train">
          <BackIcon />
        </button>
        <span className="spacer" />
        <button className="icon-btn" type="button" onClick={() => setSheet('menu')} aria-label="Workout options">
          <MoreIcon />
        </button>
      </div>

      {current ? (
        <ExerciseFocus
          key={current.id}
          workoutId={workout.id}
          workoutName={workout.name}
          exercise={current}
          position={index + 1}
          count={exercises.length}
          units={units}
          weightStep={weightStep(units, user?.weightStepKg)}
          onLogged={() => {
            // Pin the exercise once you log against it, so finishing its last set doesn't make the
            // "first unfinished" fallback whisk you off to the next one before you choose to go.
            if (selectedId !== current.id) pin(current.id)
            rest.start(current.restSeconds)
          }}
        />
      ) : (
        <div className="card empty">
          <h3>Empty workout</h3>
          <p className="small">Add the first exercise to get going.</p>
          <button className="btn primary" type="button" style={{ marginTop: 16 }} onClick={() => setSheet('picker')}>
            <PlusIcon className="icon-sm" />
            Add exercise
          </button>
        </div>
      )}

      <Dock
        workout={workout}
        current={current}
        rest={rest}
        hasPrev={Boolean(prev)}
        hasNext={Boolean(next)}
        onExercises={() => setSheet('exercises')}
        onRest={() => setSheet('menu')}
        onPrev={() => prev && select(prev.id)}
        onNext={() => next && select(next.id)}
        onDone={() => (next ? select(next.id) : setSheet('finish'))}
      />

      {sheet === 'exercises' ? (
        <ExercisesSheet
          exercises={exercises}
          currentId={current?.id}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            select(id)
            setSheet(null)
          }}
          onAdd={() => setSheet('picker')}
        />
      ) : null}

      {sheet === 'picker' ? (
        <ExercisePicker
          usedIds={new Set(exercises.map((we) => we.exerciseId))}
          onClose={() => setSheet(null)}
          onPick={(exercise) => {
            addExercise.mutate(exercise.id, {
              onSuccess: (updated) => {
                const added = updated.exercises.filter((we) => we.exerciseId === exercise.id).at(-1)
                if (added) select(added.id)
              },
            })
            setSheet(null)
          }}
        />
      ) : null}

      {sheet === 'menu' ? (
        <WorkoutMenu
          workoutId={workout.id}
          exercise={current}
          onClose={() => setSheet(null)}
          onFinish={() => setSheet('finish')}
        />
      ) : null}

      {sheet === 'finish' ? (
        <FinishSheet
          workout={workout}
          units={units}
          bodyWeightKg={user?.bodyWeightKg}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </main>
  )
}

function ExerciseFocus({
  workoutId, workoutName, exercise, position, count, units, weightStep, onLogged,
}: {
  workoutId: string
  workoutName: string
  exercise: WorkoutExercise
  position: number
  count: number
  units: Units
  weightStep: number
  onLogged: () => void
}) {
  const previous = exercise.previous
  const fields = fieldsFor(exercise.modality, units, weightStep)

  return (
    <section className="focus">
      <p className="focus-eyebrow">
        {workoutName} · {position} of {count}
      </p>
      <h1 className="focus-title">{exercise.exerciseName}</h1>
      <p className="faint small">
        {previous
          ? `Last time ${formatRelative(previous.performedAt)} - ${summarisePrevious(previous.sets, units)}`
          : 'First time logging this'}
      </p>

      <LogSetCard workoutId={workoutId} exercise={exercise} units={units} fields={fields} onLogged={onLogged} />

      {exercise.sets.length > 0 ? (
        <div className="set-grid" role="table">
          <div className="set-head" role="row">
            <span role="columnheader">Set</span>
            {fields.map((field) => (
              <span key={field.key} role="columnheader">{field.short}</span>
            ))}
            <span role="columnheader" aria-label="Done" />
            <span role="columnheader" aria-label="Delete" />
          </div>

          {exercise.sets.map((set, i) => (
            <SetRow
              key={set.id}
              workoutId={workoutId}
              weId={exercise.id}
              set={set}
              index={i}
              modality={exercise.modality}
              units={units}
              fields={fields}
              onCompleted={onLogged}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * The big steppers. They edit the next unticked set if there is one (a routine pre-plans its
 * sets), and otherwise a new set; the tick writes it and marks it done in one go.
 */
function LogSetCard({
  workoutId, exercise, units, fields, onLogged,
}: {
  workoutId: string
  exercise: WorkoutExercise
  units: Units
  fields: FieldSpec[]
  onLogged: () => void
}) {
  const addSet = useAddSet(workoutId)
  const updateSet = useUpdateSet(workoutId)

  const target = exercise.sets.find((s) => !s.isCompleted)
  const seedKey = `${target?.id ?? 'new'}:${exercise.sets.length}`
  const [seededFor, setSeededFor] = useState(seedKey)
  const [values, setValues] = useState(() => seedValues(exercise, target, units))

  // Re-seed only when the set being logged changes - after a tick moves on to the next one.
  // Done during render against the target's id rather than in an effect, so a background refetch
  // of the same set never resets a number while it is being dialled in.
  if (seededFor !== seedKey) {
    setSeededFor(seedKey)
    setValues(seedValues(exercise, target, units))
  }

  const busy = addSet.isPending || updateSet.isPending
  const empty = !values.primary.trim() && !values.secondary.trim()
  const setNumber = target ? exercise.sets.indexOf(target) + 1 : exercise.sets.length + 1

  function log() {
    const parsed = parseInputs(values.primary, values.secondary, exercise.modality, units)
    if (target) updateSet.mutate({ weId: exercise.id, setId: target.id, ...parsed, isCompleted: true })
    else addSet.mutate({ weId: exercise.id, ...parsed, isCompleted: true })
    onLogged()
  }

  return (
    <div className="log-card">
      <div className="steppers">
        {fields.map((field) => (
          <div className="stepper" key={field.key}>
            <span className="stepper-label">{field.label}</span>
            <div className="stepper-row">
              <button
                className="step-btn"
                type="button"
                onClick={() => setValues((v) => ({ ...v, [field.key]: stepValue(v[field.key], field, -1) }))}
                aria-label={`Decrease ${field.label}`}
              >
                <MinusCircleIcon />
              </button>
              <input
                className="stepper-input tabular"
                value={values[field.key]}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
                inputMode={field.inputMode}
                placeholder="-"
                aria-label={field.label}
              />
              <button
                className="step-btn"
                type="button"
                onClick={() => setValues((v) => ({ ...v, [field.key]: stepValue(v[field.key], field, 1) }))}
                aria-label={`Increase ${field.label}`}
              >
                <PlusCircleIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="log-action">
        <button className="log-btn" type="button" disabled={busy || empty} onClick={log} aria-label={`Log set ${setNumber}`}>
          <CheckIcon />
        </button>
        <span className="log-caption">
          Set {setNumber}
          {target?.isWarmup ? ' · warm-up' : ''}
        </span>
      </div>
    </div>
  )
}

function SetRow({
  workoutId, weId, set, index, modality, units, fields, onCompleted,
}: {
  workoutId: string
  weId: string
  set: WorkoutSet
  index: number
  modality: Modality
  units: Units
  fields: FieldSpec[]
  onCompleted: () => void
}) {
  const update = useUpdateSet(workoutId)
  const remove = useDeleteSet(workoutId)

  // Held locally while typing so the field never fights the cache mid-keystroke; committed on blur.
  const [primary, setPrimary] = useState(() => primaryValue(set, modality, units))
  const [secondary, setSecondary] = useState(() => secondaryValue(set, modality))
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Re-sync when the server's view of this set changes - but never over an input that currently
    // has the cursor in it, or a refetch triggered by tabbing back to the app would wipe out a
    // half-entered number.
    if (rowRef.current?.contains(document.activeElement)) return

    setPrimary(primaryValue(set, modality, units))
    setSecondary(secondaryValue(set, modality))
  }, [set, modality, units])

  function commit(extra?: { isCompleted?: boolean }) {
    const payload = { weId, setId: set.id, ...parseInputs(primary, secondary, modality, units), ...extra }
    update.mutate(payload)
  }

  function toggleComplete() {
    const next = !set.isCompleted
    commit({ isCompleted: next })
    if (next) onCompleted()
  }

  const values = { primary, secondary }
  const setters = { primary: setPrimary, secondary: setSecondary }

  return (
    <div
      ref={rowRef}
      className={`set-row${set.isCompleted ? ' done' : ''}${set.isWarmup ? ' warmup' : ''}`}
      role="row"
    >
      <button
        className="set-index"
        type="button"
        onClick={() => update.mutate({ weId, setId: set.id, isWarmup: !set.isWarmup })}
        title={set.isWarmup ? 'Warm-up set - tap to make it a working set' : 'Tap to mark as a warm-up'}
      >
        {set.isWarmup ? 'W' : index + 1}
      </button>

      {fields.map((field) => (
        <input
          key={field.key}
          className="set-input tabular"
          value={values[field.key]}
          onChange={(event) => setters[field.key](event.target.value)}
          onBlur={() => commit()}
          inputMode={field.inputMode}
          placeholder="-"
          aria-label={field.label}
        />
      ))}

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

/**
 * The fixed panel at the bottom: the exercise list, a clock, the rest length, and the controls
 * that move between exercises. The clock is the rest countdown while one runs - that is the
 * number you look at between sets - and the workout's elapsed time otherwise.
 */
function Dock({
  workout, current, rest, hasPrev, hasNext, onExercises, onRest, onPrev, onNext, onDone,
}: {
  workout: Workout
  current: WorkoutExercise | undefined
  rest: RestTimer
  hasPrev: boolean
  hasNext: boolean
  onExercises: () => void
  onRest: () => void
  onPrev: () => void
  onNext: () => void
  onDone: () => void
}) {
  const elapsed = useElapsed(workout.startedAt)
  const resting = rest.remaining !== null
  const over = rest.remaining === 0
  const total = rest.total ?? rest.remaining ?? 0
  const progress = resting && total > 0 ? 1 - (rest.remaining ?? 0) / total : 0

  return (
    <div className={`dock${resting ? ' resting' : ''}${over ? ' over' : ''}`}>
      <div className="dock-inner">
        <div className="dock-top">
          <button className="dock-side" type="button" onClick={onExercises}>
            <ListIcon />
            <span>All<br />exercises</span>
          </button>

          {resting ? (
            <button className="dock-clock" type="button" onClick={rest.stop} aria-label="Skip rest">
              <b className="tabular" role="status">{over ? 'Go' : formatDuration(rest.remaining)}</b>
              <span>{over ? 'Rest over' : 'Rest · tap to skip'}</span>
            </button>
          ) : (
            <div className="dock-clock">
              <b className="tabular">{formatDuration(elapsed)}</b>
              <span>Workout</span>
            </div>
          )}

          <button
            className="dock-side end"
            type="button"
            onClick={onRest}
            disabled={!current}
            aria-label="Rest between sets"
          >
            <span className="tabular">
              {current ? (current.restSeconds ? formatDuration(current.restSeconds) : 'Off') : '-'}
            </span>
            <TimerIcon />
          </button>
        </div>

        <div className="dock-progress" aria-hidden>
          <div style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className="dock-actions">
          <button className="dock-skip prev" type="button" disabled={!hasPrev} onClick={onPrev} aria-label="Previous exercise">
            <SkipIcon />
          </button>
          <button
            className="dock-done"
            type="button"
            onClick={onDone}
            aria-label={hasNext ? 'Exercise done, go to the next' : 'Finish workout'}
          >
            <CheckIcon />
          </button>
          <button className="dock-skip" type="button" disabled={!hasNext} onClick={onNext} aria-label="Next exercise">
            <SkipIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function ExercisesSheet({
  exercises, currentId, onClose, onPick, onAdd,
}: {
  exercises: WorkoutExercise[]
  currentId: string | undefined
  onClose: () => void
  onPick: (id: string) => void
  onAdd: () => void
}) {
  return (
    <Sheet
      title="All exercises"
      onClose={onClose}
      footer={
        <button className="btn block" type="button" onClick={onAdd}>
          <PlusIcon className="icon-sm" />
          Add exercise
        </button>
      }
    >
      {exercises.length === 0 ? <p className="muted small">Nothing added yet.</p> : null}
      <ol className="exercise-list">
        {exercises.map((we, i) => {
          const done = we.sets.filter((s) => s.isCompleted).length
          const finished = we.sets.length > 0 && done === we.sets.length

          return (
            <li key={we.id}>
              <button
                className={`exercise-pick${we.id === currentId ? ' current' : ''}${finished ? ' done' : ''}`}
                type="button"
                onClick={() => onPick(we.id)}
                aria-current={we.id === currentId ? 'step' : undefined}
              >
                <span className="num">{finished ? <CheckIcon /> : i + 1}</span>
                <span className="name">
                  {we.exerciseName}
                  <small className="tabular">{done}/{we.sets.length} sets done</small>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </Sheet>
  )
}

function WorkoutMenu({
  workoutId, exercise, onClose, onFinish,
}: {
  workoutId: string
  exercise: WorkoutExercise | undefined
  onClose: () => void
  onFinish: () => void
}) {
  const removeExercise = useRemoveWorkoutExercise(workoutId)
  const updateExercise = useUpdateWorkoutExercise(workoutId)

  return (
    <Sheet title={exercise?.exerciseName ?? 'Workout'} onClose={onClose}>
      {exercise ? (
        <>
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
                onClose()
              }
            }}
          >
            <TrashIcon className="icon-sm" />
            Remove from workout
          </button>

          <div className="divider" />
        </>
      ) : null}

      <button className="btn primary block" type="button" onClick={onFinish}>
        Finish workout
      </button>
    </Sheet>
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
  const [name, setName] = useState(workout.name)
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
        <span className="label">Name</span>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      </label>

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
        onClick={() => {
          const trimmed = name.trim()
          update.mutate(
            { id: workout.id, name: trimmed && trimmed !== workout.name ? trimmed : undefined, notes, finish: true },
            { onSuccess: () => navigate(`/history/${workout.id}`, { replace: true }) },
          )
        }}
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

// ---- which exercise is on screen ----

function firstUnfinished(exercises: WorkoutExercise[]): WorkoutExercise | undefined {
  return exercises.find((we) => we.sets.length === 0 || we.sets.some((s) => !s.isCompleted)) ?? exercises.at(-1)
}

function readCurrent(): string | null {
  try {
    return sessionStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

function writeCurrent(id: string) {
  try {
    sessionStorage.setItem(CURRENT_KEY, id)
  } catch {
    // Private mode can refuse storage; the choice still holds for this page view.
  }
}

// ---- modality-aware field plumbing ----
// Each exercise type puts different things in the two values, so labels, stepping, parsing and
// formatting all key off the modality rather than being hard-coded to weight and reps.

type FieldKey = 'primary' | 'secondary'

interface FieldSpec {
  key: FieldKey
  label: string
  /** Column heading in the set list, where space is tight. */
  short: string
  /** Entered as m:ss rather than a plain number. */
  clock: boolean
  step: number
  min: number | null
  inputMode: 'text' | 'numeric' | 'decimal'
}

/**
 * The two values for a modality, in display order: reps above weight, as on a gym machine log.
 * `weightStep` is in display units - the user's own setting, from weightStep() in lib/units.
 */
function fieldsFor(modality: Modality, units: Units, weightStep: number): FieldSpec[] {
  const reps: FieldSpec = { key: 'secondary', label: 'Reps', short: 'Reps', clock: false, step: 1, min: 0, inputMode: 'numeric' }

  if (modality === 'Duration') {
    return [
      { key: 'primary', label: 'Time', short: 'Time', clock: true, step: 15, min: 0, inputMode: 'text' },
      reps,
    ]
  }

  if (modality === 'DistanceDuration') {
    return [
      { key: 'primary', label: 'Distance (m)', short: 'Meters', clock: false, step: 100, min: 0, inputMode: 'decimal' },
      { key: 'secondary', label: 'Time', short: 'Time', clock: true, step: 15, min: 0, inputMode: 'text' },
    ]
  }

  const bodyweight = modality === 'BodyweightReps'
  return [
    reps,
    {
      key: 'primary',
      label: bodyweight ? `Added weight (${units})` : `Weight (${units})`,
      short: bodyweight ? `+${units}` : units,
      clock: false,
      step: weightStep,
      // Negative added load is how an assisted pull-up is logged.
      min: bodyweight ? null : 0,
      inputMode: 'decimal',
    },
  ]
}

function stepValue(text: string, field: FieldSpec, direction: 1 | -1): string {
  const current = (field.clock ? parseClock(text) : parseNumber(text)) ?? 0
  let next = current + direction * field.step
  if (field.min !== null) next = Math.max(field.min, next)
  next = Math.round(next * 100) / 100
  return field.clock ? formatDuration(next) : String(next)
}

/**
 * Where the steppers start: the planned values of the set being logged, else the last set done
 * this session (the common "same again" case), else the matching set from last time.
 */
function seedValues(
  exercise: WorkoutExercise, target: WorkoutSet | undefined, units: Units,
): Record<FieldKey, string> {
  const position = target ? exercise.sets.indexOf(target) : exercise.sets.length
  const source: Partial<WorkoutSet> | undefined =
    (target && hasValues(target) ? target : undefined) ??
    exercise.sets.filter((s) => s.isCompleted && hasValues(s)).at(-1) ??
    exercise.previous?.sets[position]

  if (!source) return { primary: '', secondary: '' }
  return {
    primary: primaryValue(source, exercise.modality, units),
    secondary: secondaryValue(source, exercise.modality),
  }
}

function hasValues(set: Partial<WorkoutSet>): boolean {
  return set.weightKg != null || set.reps != null || set.durationSeconds != null || set.distanceM != null
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
