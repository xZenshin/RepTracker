import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMe, useRoutine, useSaveRoutine } from '../api/hooks'
import type { Exercise, SaveRoutineExercise, Units } from '../api/types'
import { ApiError } from '../api/client'
import { formatDuration } from '../lib/time'
import { toDisplay, toKg } from '../lib/units'
import ExercisePicker from '../components/ExercisePicker'
import { BackIcon, PlusIcon, TrashIcon } from '../components/Icons'
import './routine-editor.css'

/** A row being edited, carrying the exercise name so the list can render without another lookup. */
interface Draft extends SaveRoutineExercise {
  key: string
  exerciseName: string
  muscleGroup: string
}

export default function RoutineEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const existing = useRoutine(id)
  const save = useSaveRoutine(id)
  const { data: user } = useMe()

  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Draft[]>([])
  const [picking, setPicking] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const units = user?.units ?? 'kg'

  useEffect(() => {
    if (!existing.data || loaded) return
    setName(existing.data.name)
    setNotes(existing.data.notes ?? '')
    setRows(
      existing.data.exercises.map((exercise) => ({
        key: exercise.id,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        muscleGroup: exercise.muscleGroup,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin ?? null,
        targetRepsMax: exercise.targetRepsMax ?? null,
        targetWeightKg: exercise.targetWeightKg ?? null,
        restSeconds: exercise.restSeconds,
        notes: exercise.notes ?? null,
      })),
    )
    setLoaded(true)
  }, [existing.data, loaded])

  function update(key: string, patch: Partial<Draft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    setRows((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function add(exercise: Exercise) {
    setRows((current) => [
      ...current,
      {
        key: `${exercise.id}-${Date.now()}`,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        muscleGroup: exercise.muscleGroup,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: null,
        targetWeightKg: null,
        restSeconds: 120,
        notes: null,
      },
    ])
    setPicking(false)
  }

  const canSave = name.trim().length > 0 && rows.length > 0

  return (
    <main className="page">
      <div className="page-header">
        <div className="row" style={{ minWidth: 0 }}>
          <button className="btn ghost sm" type="button" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon className="icon-sm" />
          </button>
          <h1>{id ? 'Edit routine' : 'New routine'}</h1>
        </div>
      </div>

      <div className="card">
        <label className="field">
          <span className="label">Routine name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Push A, Upper Body, Leg Day..."
            maxLength={60}
            autoFocus={!id}
          />
        </label>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="label">Notes (optional)</span>
          <textarea
            className="textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything you want to remember about this day"
            maxLength={500}
          />
        </label>
      </div>

      <div className="card-title" style={{ marginTop: 18 }}>
        <h2>Exercises</h2>
        <span className="hint">{rows.length} in this routine</span>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          <h3>No exercises yet</h3>
          <p className="small">Add the movements you do on this day, in the order you do them.</p>
        </div>
      ) : (
        <div className="stack">
          {rows.map((row, index) => (
            <article key={row.key} className="routine-row">
              <header>
                <div className="order">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">&#9650;</button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label="Move down">&#9660;</button>
                </div>
                <div className="titles">
                  <strong>{row.exerciseName}</strong>
                  <span className="faint small">{row.muscleGroup}</span>
                </div>
                <button
                  className="btn danger sm"
                  type="button"
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  aria-label={`Remove ${row.exerciseName}`}
                >
                  <TrashIcon className="icon-sm" />
                </button>
              </header>

              <div className="targets">
                <label>
                  <span className="label">Sets</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={50}
                    value={row.targetSets}
                    onChange={(e) => update(row.key, { targetSets: clamp(Number(e.target.value), 1, 50) })}
                  />
                </label>

                <label>
                  <span className="label">Reps</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={row.targetRepsMin ?? ''}
                    onChange={(e) => update(row.key, { targetRepsMin: numberOrNull(e.target.value) })}
                    placeholder="8"
                  />
                </label>

                <label>
                  <span className="label">to (optional)</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={row.targetRepsMax ?? ''}
                    onChange={(e) => update(row.key, { targetRepsMax: numberOrNull(e.target.value) })}
                    placeholder="12"
                  />
                </label>

                <label>
                  <span className="label">Weight ({units})</span>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    min={0}
                    value={displayWeight(row.targetWeightKg, units)}
                    onChange={(e) =>
                      update(row.key, { targetWeightKg: toKg(numberOrNull(e.target.value), units) })
                    }
                    placeholder="-"
                  />
                </label>

                <label className="rest">
                  <span className="label">Rest</span>
                  <select
                    className="select"
                    value={row.restSeconds}
                    onChange={(e) => update(row.key, { restSeconds: Number(e.target.value) })}
                  >
                    {[0, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds === 0 ? 'None' : formatDuration(seconds)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>
          ))}
        </div>
      )}

      <button className="btn block add-exercise" type="button" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
        <PlusIcon className="icon-sm" />
        Add exercise
      </button>

      {save.error ? <p className="banner" style={{ marginTop: 14 }}>{(save.error as ApiError).message}</p> : null}

      <button
        className="btn primary lg block"
        type="button"
        style={{ marginTop: 16 }}
        disabled={!canSave || save.isPending}
        onClick={() =>
          save.mutate(
            {
              name: name.trim(),
              notes: notes.trim() || null,
              exercises: rows.map(({ key, exerciseName, muscleGroup, ...rest }) => rest),
            },
            { onSuccess: () => navigate('/', { replace: true }) },
          )
        }
      >
        {save.isPending ? 'Saving...' : id ? 'Save changes' : 'Create routine'}
      </button>

      {picking ? (
        <ExercisePicker
          usedIds={new Set(rows.map((r) => r.exerciseId))}
          onClose={() => setPicking(false)}
          onPick={add}
        />
      ) : null}
    </main>
  )
}

function displayWeight(kg: number | null | undefined, units: Units): string {
  const value = toDisplay(kg, units)
  if (value === null) return ''
  return String(Math.round(value * 100) / 100)
}

function numberOrNull(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isNaN(value) ? null : value
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
