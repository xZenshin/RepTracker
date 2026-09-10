import { useMemo, useState } from 'react'
import { useCreateExercise, useExercises } from '../api/hooks'
import type { Exercise } from '../api/types'
import { ApiError } from '../api/client'
import Sheet from './Sheet'
import { PlusIcon, SearchIcon } from './Icons'
import './exercise-picker.css'

interface Props {
  onPick: (exercise: Exercise) => void
  onClose: () => void
  /** Already in the workout or routine: still selectable, but marked so duplicates are deliberate. */
  usedIds?: Set<string>
}

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Forearms', 'Cardio',
]

export default function ExercisePicker({ onPick, onClose, usedIds }: Props) {
  const { data: exercises, isPending } = useExercises()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    if (!exercises) return []
    const needle = query.trim().toLowerCase()

    return exercises.filter((exercise) => {
      if (group && exercise.muscleGroup !== group) return false
      if (!needle) return true
      return (
        exercise.name.toLowerCase().includes(needle) ||
        exercise.equipment.toLowerCase().includes(needle) ||
        exercise.muscleGroup.toLowerCase().includes(needle)
      )
    })
  }, [exercises, query, group])

  const grouped = useMemo(() => {
    const map = new Map<string, Exercise[]>()
    for (const exercise of filtered) {
      const list = map.get(exercise.muscleGroup) ?? []
      list.push(exercise)
      map.set(exercise.muscleGroup, list)
    }
    return [...map.entries()].sort(
      (a, b) => MUSCLE_GROUPS.indexOf(a[0]) - MUSCLE_GROUPS.indexOf(b[0]),
    )
  }, [filtered])

  if (creating) {
    return (
      <CreateExercise
        initialName={query.trim()}
        onClose={() => setCreating(false)}
        onCreated={(exercise) => onPick(exercise)}
      />
    )
  }

  return (
    <Sheet
      title="Add exercise"
      onClose={onClose}
      footer={
        <button className="btn block" type="button" onClick={() => setCreating(true)}>
          <PlusIcon className="icon-sm" />
          Create a custom exercise
        </button>
      }
    >
      <div className="picker-search">
        <SearchIcon className="icon-sm" />
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search exercises"
          autoFocus
        />
      </div>

      <div className="picker-filters">
        <button className={group === null ? 'on' : ''} type="button" onClick={() => setGroup(null)}>
          All
        </button>
        {MUSCLE_GROUPS.map((name) => (
          <button
            key={name}
            className={group === name ? 'on' : ''}
            type="button"
            onClick={() => setGroup(group === name ? null : name)}
          >
            {name}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="stack">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 48 }} />)}
        </div>
      ) : grouped.length === 0 ? (
        <div className="empty">
          <h3>Nothing matches</h3>
          <p className="small">Create it as a custom exercise instead.</p>
        </div>
      ) : (
        grouped.map(([groupName, items]) => (
          <section key={groupName} className="picker-group">
            <h3 className="faint small">{groupName}</h3>
            {items.map((exercise) => (
              <button key={exercise.id} className="picker-item" type="button" onClick={() => onPick(exercise)}>
                <span className="name">{exercise.name}</span>
                <span className="row">
                  {usedIds?.has(exercise.id) ? <span className="chip accent">added</span> : null}
                  {exercise.isCustom ? <span className="chip">custom</span> : null}
                  <span className="faint small">{exercise.equipment}</span>
                </span>
              </button>
            ))}
          </section>
        ))
      )}
    </Sheet>
  )
}

function CreateExercise({
  initialName, onClose, onCreated,
}: { initialName: string; onClose: () => void; onCreated: (exercise: Exercise) => void }) {
  const create = useCreateExercise()
  const [name, setName] = useState(initialName)
  const [muscleGroup, setMuscleGroup] = useState('Chest')
  const [equipment, setEquipment] = useState('Barbell')
  const [modality, setModality] = useState('WeightReps')
  const [pattern, setPattern] = useState('push')

  return (
    <Sheet title="New exercise" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(
            { name: name.trim(), muscleGroup, equipment, modality, pattern },
            { onSuccess: onCreated },
          )
        }}
      >
        <label className="field">
          <span className="label">Name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoFocus
          />
        </label>

        <div className="grid cols-2">
          <label className="field">
            <span className="label">Muscle group</span>
            <select className="select" value={muscleGroup} onChange={(e) => setMuscleGroup(e.target.value)}>
              {MUSCLE_GROUPS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>

          <label className="field">
            <span className="label">Equipment</span>
            <select className="select" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              {['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'Other']
                .map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>

          <label className="field">
            <span className="label">Measured in</span>
            <select className="select" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="WeightReps">Weight and reps</option>
              <option value="BodyweightReps">Bodyweight reps</option>
              <option value="Duration">Time held</option>
              <option value="DistanceDuration">Distance and time</option>
            </select>
          </label>

          <label className="field">
            <span className="label">Movement</span>
            <select className="select" value={pattern} onChange={(e) => setPattern(e.target.value)}>
              {['push', 'pull', 'legs', 'core', 'cardio', 'other'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <p className="help" style={{ marginBottom: 14 }}>
          Movement decides which side of the push/pull and upper/lower balance charts this counts on.
        </p>

        {create.error ? <p className="banner">{(create.error as ApiError).message}</p> : null}

        <button className="btn primary lg block" type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? 'Creating...' : 'Create and add'}
        </button>
      </form>
    </Sheet>
  )
}
