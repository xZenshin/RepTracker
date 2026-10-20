import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RECENT_WORKOUTS, useMe, useWorkoutHistory, useWorkoutMonth } from '../api/hooks'
import type { Units, WorkoutSummary } from '../api/types'
import { formatDuration, formatTime, isoDate } from '../lib/time'
import { formatVolume } from '../lib/units'
import { ChevronIcon } from '../components/Icons'
import './history.css'

export default function History() {
  const { data: page, isPending } = useWorkoutHistory()
  const { data: user } = useMe()
  const units = user?.units ?? 'kg'

  const items = page?.items ?? []
  const groups = groupByMonth(items)

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>History</h1>
          <p className="subtitle">Every finished session lands here.</p>
        </div>
      </div>

      {isPending ? (
        <div className="stack">
          <div className="skeleton" style={{ height: 360 }} />
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 74 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <h3>Nothing logged yet</h3>
          <p className="small">Finish a workout and it will show up here.</p>
          <Link className="btn primary" to="/" style={{ marginTop: 16 }}>Start training</Link>
        </div>
      ) : (
        <>
          <MonthCalendar units={units} />

          <div className="history-recent">
            <h2>Recent workouts</h2>
            <span className="faint small">
              {page?.nextCursor ? `Last ${RECENT_WORKOUTS}` : `All ${items.length}`}
            </span>
          </div>

          {groups.map(([month, monthItems]) => (
            <section key={month} className="history-month">
              <h2>{month}</h2>
              <div className="stack">
                {monthItems.map((workout) => (
                  <HistoryRow key={workout.id} workout={workout} units={units} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  )
}

function HistoryRow({ workout, units }: { workout: WorkoutSummary; units: Units }) {
  return (
    <Link className="history-row" to={`/history/${workout.id}`}>
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
  )
}

/**
 * One month at a time, Monday first. A day you trained carries the workout's name; hovering it, or
 * reaching it with the keyboard, shows the details, and choosing it opens the workout. The month is
 * kept in the URL so coming Back from a workout lands on the same month.
 */
function MonthCalendar({ units }: { units: Units }) {
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const current = new Date(today.getFullYear(), today.getMonth(), 1)
  const month = parseMonth(params.get('month'), current)
  const isCurrent = month.getTime() === current.getTime()

  const { data, isPending, isPlaceholderData } = useWorkoutMonth(month)

  // The day whose workouts are listed under the grid: only needed when a day holds more than one.
  const [picked, setPicked] = useState<string | null>(null)

  const go = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1)
    setPicked(null)
    setParams(next.getTime() === current.getTime() ? {} : { month: monthKey(next) }, { replace: true })
  }

  const byDay = new Map<string, WorkoutSummary[]>()
  // Oldest first within a day, so a morning session is listed before the evening one.
  for (const workout of [...(data?.items ?? [])].reverse()) {
    const key = isoDate(new Date(workout.startedAt))
    byDay.set(key, [...(byDay.get(key) ?? []), workout])
  }

  const lead = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }),
  )
  const count = data?.items.length ?? 0
  const todayKey = isoDate(today)
  const pickedWorkouts = picked ? byDay.get(picked) ?? [] : []

  return (
    <section className="card cal">
      <div className="cal-head">
        <div>
          <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <p className="faint small">
            {isPending ? ' ' : count === 0 ? 'No workouts' : `${count} workout${count === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="cal-nav">
          {!isCurrent ? (
            <button className="btn ghost sm" type="button" onClick={() => setParams({}, { replace: true })}>
              This month
            </button>
          ) : null}
          <button className="btn sm cal-step" type="button" onClick={() => go(-1)} aria-label="Previous month">
            <ChevronIcon className="flip" />
          </button>
          <button className="btn sm cal-step" type="button" onClick={() => go(1)} disabled={isCurrent} aria-label="Next month">
            <ChevronIcon />
          </button>
        </div>
      </div>

      <div className={`cal-grid${isPlaceholderData ? ' loading' : ''}`}>
        {weekdays.map((name) => <div key={name} className="cal-weekday">{name}</div>)}

        {cells.map((date, index) => {
          if (!date) return <div key={`pad-${index}`} className="cal-day pad" />

          const key = isoDate(date)
          const workouts = byDay.get(key) ?? []
          const column = index % 7
          const classes = [
            'cal-day',
            workouts.length > 0 ? 'trained' : '',
            key === todayKey ? 'today' : '',
            key === picked ? 'picked' : '',
          ].join(' ')

          if (workouts.length === 0) {
            return (
              <div key={key} className={classes}>
                <span className="cal-num">{date.getDate()}</span>
              </div>
            )
          }

          const label = `${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}: ${workouts.map((w) => w.name).join(', ')}`
          const face = (
            <>
              <span className="cal-num">{date.getDate()}</span>
              <span className="cal-name">{workouts[0].name}</span>
              {workouts.length > 1 ? <span className="cal-more">+{workouts.length - 1}</span> : null}
            </>
          )

          return (
            <div key={key} className={classes}>
              {workouts.length === 1 ? (
                <Link className="cal-hit" to={`/history/${workouts[0].id}`} aria-label={label}>{face}</Link>
              ) : (
                <button className="cal-hit" type="button" aria-label={label} aria-expanded={key === picked}
                  onClick={() => setPicked(key === picked ? null : key)}>
                  {face}
                </button>
              )}

              <div className={`cal-tip ${column < 2 ? 'start' : column > 4 ? 'end' : ''}`} aria-hidden="true">
                <div className="cal-tip-date">
                  {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {workouts.map((workout) => (
                  <div key={workout.id} className="cal-tip-workout">
                    <b>{workout.name}</b>
                    <span>
                      {formatTime(workout.startedAt)}
                      {workout.durationSeconds ? `, ${formatDuration(workout.durationSeconds)}` : ''}
                    </span>
                    <span>{formatVolume(workout.volumeKg, units)} in {workout.sets} sets</span>
                    {workout.muscleGroups.length > 0 ? (
                      <span className="faint">{workout.muscleGroups.join(', ')}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {pickedWorkouts.length > 0 ? (
        <div className="cal-picked stack">
          {pickedWorkouts.map((workout) => (
            <HistoryRow key={workout.id} workout={workout} units={units} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** `2026-08` to local midnight on 1 August; anything unreadable or in the future is this month. */
function parseMonth(value: string | null, current: Date): Date {
  const match = value?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return current
  const month = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  return Number.isNaN(month.getTime()) || month > current ? current : month
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
