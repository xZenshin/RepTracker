import { useNavigate } from 'react-router-dom'
import { useActiveWorkout, useDeleteRoutine, useMe, useRoutines, useStartWorkout } from '../api/hooks'
import { ApiError } from '../api/client'
import { formatDuration } from '../lib/time'
import { formatWeight } from '../lib/units'
import { ChevronIcon, PlusIcon, TimerIcon } from '../components/Icons'
import { useElapsed } from '../lib/useElapsed'
import './train.css'

export default function Train() {
  const navigate = useNavigate()
  const { data: user } = useMe()
  const { data: active } = useActiveWorkout()
  const { data: routines, isPending } = useRoutines()
  const start = useStartWorkout()
  const deleteRoutine = useDeleteRoutine()

  const units = user?.units ?? 'kg'

  function begin(routineId?: string) {
    start.mutate(
      { routineId },
      {
        onSuccess: () => navigate('/workout'),
        // A 409 means a workout is already open. Going there is what the user wanted anyway.
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) navigate('/workout')
        },
      },
    )
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>{greeting()}{user?.displayName ? `, ${user.displayName}` : ''}</h1>
          <p className="subtitle">
            {active ? 'You have a workout in progress.' : 'Pick a routine, or just start lifting.'}
          </p>
        </div>
      </div>

      {active ? <ResumeCard onOpen={() => navigate('/workout')} startedAt={active.startedAt} name={active.name} sets={active.totals.sets} /> : null}

      {start.error && !(start.error instanceof ApiError && start.error.status === 409) ? (
        <p className="banner" style={{ marginBottom: 12 }}>{(start.error as ApiError).message}</p>
      ) : null}

      <section>
        <div className="card-title">
          <h2>Routines</h2>
          <button className="btn sm" type="button" onClick={() => navigate('/routines/new')}>
            <PlusIcon className="icon-sm" />
            New
          </button>
        </div>

        {isPending ? (
          <div className="stack">
            <div className="skeleton" style={{ height: 84 }} />
            <div className="skeleton" style={{ height: 84 }} />
          </div>
        ) : routines?.length ? (
          <div className="grid cols-2">
            {routines.map((routine) => (
              <article key={routine.id} className="routine-card">
                <header>
                  <h3>{routine.name}</h3>
                  <span className="faint small">
                    {routine.exercises.length} exercise{routine.exercises.length === 1 ? '' : 's'}
                  </span>
                </header>

                <ul className="routine-preview">
                  {routine.exercises.slice(0, 4).map((exercise) => (
                    <li key={exercise.id}>
                      <span className="name">{exercise.exerciseName}</span>
                      <span className="faint tabular">
                        {exercise.targetSets} x {repRange(exercise.targetRepsMin, exercise.targetRepsMax)}
                        {exercise.targetWeightKg
                          ? ` @ ${formatWeight(exercise.targetWeightKg, units, false)}`
                          : ''}
                      </span>
                    </li>
                  ))}
                  {routine.exercises.length > 4 ? (
                    <li className="faint">+{routine.exercises.length - 4} more</li>
                  ) : null}
                </ul>

                <footer>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => begin(routine.id)}
                    disabled={start.isPending}
                  >
                    Start
                  </button>
                  <button className="btn ghost sm" type="button" onClick={() => navigate(`/routines/${routine.id}`)}>
                    Edit
                  </button>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete the routine "${routine.name}"? Past workouts are kept.`)) {
                        deleteRoutine.mutate(routine.id)
                      }
                    }}
                  >
                    Delete
                  </button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="card empty">
            <h3>No routines yet</h3>
            <p className="small">
              A routine is a template - the exercises and target sets for one training day. Starting
              from one fills the session in for you.
            </p>
            <button className="btn primary" type="button" style={{ marginTop: 16 }} onClick={() => navigate('/routines/new')}>
              Build your first routine
            </button>
          </div>
        )}
      </section>

      {!active ? (
        <button
          className="btn lg block"
          type="button"
          style={{ marginTop: 16 }}
          onClick={() => begin()}
          disabled={start.isPending}
        >
          Start an empty workout
        </button>
      ) : null}
    </main>
  )
}

function ResumeCard({
  name, startedAt, sets, onOpen,
}: { name: string; startedAt: string; sets: number; onOpen: () => void }) {
  const elapsed = useElapsed(startedAt)

  return (
    <button className="resume-card" type="button" onClick={onOpen}>
      <span className="pulse" aria-hidden />
      <div>
        <strong>{name}</strong>
        <span className="small">
          <TimerIcon className="icon-sm" />
          <span className="tabular">{formatDuration(elapsed)}</span>
          <span aria-hidden>&middot;</span>
          {sets} set{sets === 1 ? '' : 's'} logged
        </span>
      </div>
      <ChevronIcon />
    </button>
  )
}

function repRange(min?: number | null, max?: number | null) {
  if (min && max && min !== max) return `${min}-${max}`
  return String(min ?? max ?? '-')
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Late one'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
