import { Link } from 'react-router-dom'
import { useMe, useWorkoutHistory } from '../api/hooks'
import { formatDuration, formatTime } from '../lib/time'
import { formatVolume } from '../lib/units'
import './history.css'

export default function History() {
  const { data: page, isPending } = useWorkoutHistory()
  const { data: user } = useMe()
  const units = user?.units ?? 'kg'

  const groups = groupByMonth(page?.items ?? [])

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>History</h1>
          <p className="subtitle">
            {page?.items.length
              ? `${page.items.length} workout${page.items.length === 1 ? '' : 's'}${page.nextCursor ? ' (most recent)' : ''}`
              : 'Every finished session lands here.'}
          </p>
        </div>
      </div>

      {isPending ? (
        <div className="stack">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 74 }} />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="card empty">
          <h3>Nothing logged yet</h3>
          <p className="small">Finish a workout and it will show up here.</p>
          <Link className="btn primary" to="/" style={{ marginTop: 16 }}>Start training</Link>
        </div>
      ) : (
        groups.map(([month, items]) => (
          <section key={month} className="history-month">
            <h2 className="faint small">{month}</h2>
            <div className="stack">
              {items.map((workout) => (
                <Link key={workout.id} className="history-row" to={`/history/${workout.id}`}>
                  <div className="when">
                    <b>{new Date(workout.startedAt).getDate()}</b>
                    <span className="faint small">
                      {new Date(workout.startedAt).toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                  </div>

                  <div className="what">
                    <strong>{workout.name}</strong>
                    <span className="faint small">
                      {formatTime(workout.startedAt)}
                      {workout.durationSeconds ? ` - ${formatDuration(workout.durationSeconds)}` : ''}
                      {' - '}
                      {workout.muscleGroups.slice(0, 3).join(', ') || 'no exercises'}
                    </span>
                  </div>

                  <div className="numbers tabular">
                    <span>{formatVolume(workout.volumeKg, units)}</span>
                    <span className="faint small">{workout.sets} sets</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  )
}

function groupByMonth<T extends { startedAt: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()

  for (const item of items) {
    const key = new Date(item.startedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }

  return [...map.entries()]
}
