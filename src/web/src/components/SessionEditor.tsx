import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCorrectSets, useSessionReview, type SetCorrection } from '../api/hooks'
import type { SessionReview, Units, WorkoutSet } from '../api/types'
import { ApiError } from '../api/client'
import { formatDateFull } from '../lib/time'
import { fieldsFor, parseInputs, primaryValue, secondaryValue, type FieldSpec } from '../lib/setFields'
import { Neighbours } from './ExerciseOutliers'
import { TrashIcon } from './Icons'
import Sheet from './Sheet'
import './exercise-outliers.css'

/**
 * Corrects one session of an exercise by hand, opened from a point on its charts: type new values
 * into any set, mark sets to remove, or fill them in from the sessions either side. Only what
 * changed is sent, in one request, and nothing else in the workout is touched.
 */
export default function SessionEditor({
  exerciseId, workoutId, units, weightStep, onClose,
}: {
  exerciseId: string
  workoutId: string
  units: Units
  weightStep: number
  onClose: () => void
}) {
  const { data: review, isPending, error } = useSessionReview(exerciseId, workoutId)

  return (
    <Sheet title="Edit session" onClose={onClose}>
      {isPending ? <div className="skeleton" style={{ height: 220 }} /> : null}
      {error ? (
        <p className="banner">{error instanceof ApiError ? error.message : 'Could not load that session.'}</p>
      ) : null}
      {review ? (
        <Editor review={review} units={units} weightStep={weightStep} onDone={onClose} />
      ) : null}
    </Sheet>
  )
}

interface Row {
  primary: string
  secondary: string
  remove: boolean
}

function Editor({
  review, units, weightStep, onDone,
}: {
  review: SessionReview
  units: Units
  weightStep: number
  onDone: () => void
}) {
  const correct = useCorrectSets()
  const fields = fieldsFor(review.modality, units, weightStep)
  const asRow = (set: Partial<WorkoutSet>): Omit<Row, 'remove'> => ({
    primary: primaryValue(set, review.modality, units),
    secondary: secondaryValue(set, review.modality),
  })

  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(review.sets.map((set) => [set.id, { ...asRow(set), remove: false }])),
  )
  const edit = (id: string, change: Partial<Row>) =>
    setRows((current) => ({ ...current, [id]: { ...current[id], ...change } }))

  const hasNeighbours = Boolean(review.before || review.after)
  const suggestion = new Map(review.suggested.map((s) => [s.setId, s]))

  function fillFromNeighbours() {
    setRows((current) =>
      Object.fromEntries(review.sets.map((set) => {
        const suggested = suggestion.get(set.id)
        return [set.id, { ...current[set.id], ...asRow(suggested ?? set) }]
      })),
    )
  }

  // Compared as text against what the set showed when opened, so only real edits are sent.
  const original = Object.fromEntries(review.sets.map((set) => [set.id, asRow(set)]))
  const removals = review.sets.filter((set) => rows[set.id].remove).map((set) => set.id)
  const updates: SetCorrection[] = review.sets
    .filter((set) => !rows[set.id].remove)
    .filter((set) => rows[set.id].primary !== original[set.id].primary || rows[set.id].secondary !== original[set.id].secondary)
    .map((set) => ({
      id: set.id,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      distanceM: set.distanceM,
      ...parseInputs(rows[set.id].primary, rows[set.id].secondary, review.modality, units),
    }))
  const changes = updates.length + removals.length

  function save() {
    correct.mutate(
      { workoutId: review.workoutId, workoutExerciseId: review.workoutExerciseId, update: updates, remove: removals },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="session-editor">
      <header className="outlier-head">
        <h3>{formatDateFull(review.startedAt)}</h3>
        <Link to={`/history/${review.workoutId}`} className="small">Open workout</Link>
      </header>

      <Neighbours review={review} units={units} />

      <table className="outlier-sets session-sets">
        <thead>
          <tr>
            <th>Set</th>
            {fields.map((field) => <th key={field.key}>{field.label}</th>)}
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {review.sets.map((set, index) => (
            <tr key={set.id} className={rows[set.id].remove ? 'off' : undefined}>
              <td className="tabular">{index + 1}</td>
              {fields.map((field) => (
                <td key={field.key}>
                  <ValueInput
                    field={field}
                    value={rows[set.id][field.key]}
                    changed={rows[set.id][field.key] !== original[set.id][field.key]}
                    disabled={rows[set.id].remove}
                    onChange={(value) => edit(set.id, { [field.key]: value })}
                    label={`Set ${index + 1} ${field.label}`}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="session-remove"
                  aria-pressed={rows[set.id].remove}
                  aria-label={rows[set.id].remove ? `Keep set ${index + 1}` : `Remove set ${index + 1}`}
                  title={rows[set.id].remove ? 'Keep this set' : 'Remove this set'}
                  onClick={() => edit(set.id, { remove: !rows[set.id].remove })}
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {correct.error ? (
        <p className="banner">{correct.error instanceof ApiError ? correct.error.message : 'That did not go through.'}</p>
      ) : null}

      <div className="outlier-actions">
        <button className="btn primary sm" type="button" disabled={changes === 0 || correct.isPending} onClick={save}>
          {correct.isPending ? 'Saving...' : changes === 0 ? 'No changes' : `Save ${changes} change${changes === 1 ? '' : 's'}`}
        </button>
        {hasNeighbours ? (
          <button className="btn sm" type="button" onClick={fillFromNeighbours}>
            Fill from the sessions around it
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ValueInput({
  field, value, changed, disabled, onChange, label,
}: {
  field: FieldSpec
  value: string
  changed: boolean
  disabled: boolean
  onChange: (value: string) => void
  label: string
}) {
  return (
    <input
      className={`input session-input tabular${changed ? ' changed' : ''}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode={field.inputMode}
      placeholder="-"
      disabled={disabled}
      aria-label={label}
    />
  )
}
