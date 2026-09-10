import { Link, useNavigate, useParams } from 'react-router-dom'
import { useDeleteWorkout, useMe, useWorkout } from '../api/hooks'
import type { Modality, Units, WorkoutSet } from '../api/types'
import { formatDateFull, formatDuration, formatTime } from '../lib/time'
import { formatVolume, formatWeight } from '../lib/units'
import { BackIcon, TrashIcon } from '../components/Icons'
import './workout-detail.css'

export default function WorkoutDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: workout, isPending, isError } = useWorkout(id)
  const { data: user } = useMe()
  const remove = useDeleteWorkout()

  const units = user?.units ?? 'kg'

  if (isPending) {
    return (
      <main className="page">
        <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </main>
    )
  }

  if (isError || !workout) {
    return (
      <main className="page">
        <div className="card empty">
          <h3>Workout not found</h3>
          <Link className="btn" to="/history" style={{ marginTop: 14 }}>Back to history</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-header">
        <div className="row" style={{ minWidth: 0 }}>
          <button className="btn ghost sm" type="button" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon className="icon-sm" />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1>{workout.name}</h1>
            <p className="subtitle">
              {formatDateFull(workout.startedAt)} at {formatTime(workout.startedAt)}
              {workout.routineName ? ` - from ${workout.routineName}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="detail-totals">
        <div><b className="tabular">{formatVolume(workout.totals.volumeKg, units)}</b><span className="faint small">volume</span></div>
        <div><b className="tabular">{workout.totals.sets}</b><span className="faint small">sets</span></div>
        <div><b className="tabular">{workout.totals.reps}</b><span className="faint small">reps</span></div>
        <div><b className="tabular">{formatDuration(workout.totals.durationSeconds)}</b><span className="faint small">time</span></div>
      </div>

      {workout.notes ? (
        <div className="card note-card">
          <h3 className="faint small">Notes</h3>
          <p>{workout.notes}</p>
        </div>
      ) : null}

      {workout.exercises.map((we) => (
        <section key={we.id} className="card detail-exercise">
          <div className="card-title">
            <h2>
              <Link to={`/stats/${we.exerciseId}`}>{we.exerciseName}</Link>
            </h2>
            <span className="hint">{we.muscleGroup}</span>
          </div>

          <table className="detail-sets">
            <thead>
              <tr>
                <th>Set</th>
                <th>{we.modality === 'Duration' ? 'Time' : we.modality === 'DistanceDuration' ? 'Distance' : 'Weight'}</th>
                <th>{we.modality === 'DistanceDuration' ? 'Time' : 'Reps'}</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {we.sets.map((set, index) => (
                <tr key={set.id} className={set.isWarmup ? 'warmup' : ''}>
                  <td className="tabular">{set.isWarmup ? 'W' : index + 1}</td>
                  <td className="tabular">{primaryCell(set, we.modality, units)}</td>
                  <td className="tabular">{secondaryCell(set, we.modality)}</td>
                  <td className="tabular faint">
                    {set.isWarmup || !set.weightKg || !set.reps
                      ? '-'
                      : formatVolume(set.weightKg * set.reps, units)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {we.notes ? <p className="faint small" style={{ marginTop: 10 }}>{we.notes}</p> : null}
        </section>
      ))}

      <button
        className="btn danger block"
        type="button"
        style={{ marginTop: 16 }}
        onClick={() => {
          if (confirm('Delete this workout permanently? Your statistics will be recalculated without it.')) {
            remove.mutate(workout.id, { onSuccess: () => navigate('/history', { replace: true }) })
          }
        }}
      >
        <TrashIcon className="icon-sm" />
        Delete workout
      </button>
    </main>
  )
}

function primaryCell(set: WorkoutSet, modality: Modality, units: Units) {
  if (modality === 'Duration') return formatDuration(set.durationSeconds)
  if (modality === 'DistanceDuration') return set.distanceM ? `${set.distanceM} m` : '-'
  return formatWeight(set.weightKg, units)
}

function secondaryCell(set: WorkoutSet, modality: Modality) {
  if (modality === 'DistanceDuration') return formatDuration(set.durationSeconds)
  return set.reps ?? '-'
}
