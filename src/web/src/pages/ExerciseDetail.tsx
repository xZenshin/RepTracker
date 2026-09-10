import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Dot, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useExerciseStats, useMe, useStatExercises } from '../api/hooks'
import type { ExerciseSessionPoint, Trend, Units } from '../api/types'
import { formatVolume, formatWeight, toDisplay } from '../lib/units'
import { formatRelative } from '../lib/time'
import { BackIcon, TrophyIcon } from '../components/Icons'
import '../styles/viz.css'
import './workout-detail.css'

const PERIODS = [
  { weeks: 12, label: '12w' },
  { weeks: 26, label: '6m' },
  { weeks: 52, label: '1y' },
  { weeks: 156, label: 'All' },
]

export default function ExerciseDetail() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const [weeks, setWeeks] = useState(52)
  const { data, isPending, isError } = useExerciseStats(exerciseId, weeks)
  const { data: all } = useStatExercises()
  const { data: user } = useMe()

  const units = user?.units ?? 'kg'

  return (
    <main className="page viz">
      <div className="page-header">
        <div className="row" style={{ minWidth: 0 }}>
          <button className="btn ghost sm" type="button" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon className="icon-sm" />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1>{data?.exerciseName ?? 'Exercise'}</h1>
            <p className="subtitle">{data ? `${data.muscleGroup} - ${data.sessions.length} sessions` : ''}</p>
          </div>
        </div>
      </div>

      {all && all.length > 1 ? (
        <label className="field">
          <span className="label">Exercise</span>
          <select
            className="select"
            value={exerciseId ?? ''}
            onChange={(event) => navigate(`/stats/${event.target.value}`, { replace: true })}
          >
            {all.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.sessions})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="segmented">
          {PERIODS.map((period) => (
            <button
              key={period.weeks}
              className={weeks === period.weeks ? 'on' : ''}
              type="button"
              onClick={() => setWeeks(period.weeks)}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <>
          <div className="skeleton" style={{ height: 96, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 300 }} />
        </>
      ) : isError || !data ? (
        <div className="card empty">
          <h3>Nothing logged for this exercise</h3>
          <p className="small">Complete a working set and its progress will show up here.</p>
        </div>
      ) : (
        <>
          <section className="tiles">
            <div className="tile">
              <div className="label"><TrophyIcon /> Best est. 1RM</div>
              <div className="value">{formatWeight(data.records.bestOneRepMax, units, false)}<span style={{ fontSize: '0.9rem', fontWeight: 600 }}> {units}</span></div>
              <div className="foot">
                {data.records.bestOneRepMaxAt ? formatRelative(data.records.bestOneRepMaxAt) : '-'}
              </div>
            </div>

            <div className="tile">
              <div className="label">Heaviest set</div>
              <div className="value">{formatWeight(data.records.bestWeightKg, units, false)}<span style={{ fontSize: '0.9rem', fontWeight: 600 }}> {units}</span></div>
              <div className="foot">for {data.records.bestWeightReps ?? '-'} reps</div>
            </div>

            <div className="tile">
              <div className="label">Best session</div>
              <div className="value">{formatVolume(data.records.bestSessionVolumeKg ?? 0, units)}</div>
              <div className="foot">
                {data.records.bestSessionVolumeAt ? formatRelative(data.records.bestSessionVolumeAt) : '-'}
              </div>
            </div>

            <div className="tile">
              <div className="label">Trend</div>
              <TrendValue trend={data.trend} units={units} />
            </div>
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Estimated 1RM</h2>
              <span className="hint">Best set each session</span>
            </div>
            <OneRepMaxChart sessions={data.sessions} units={units} />
            <p className="faint small" style={{ marginTop: 10 }}>
              Estimated with the Epley formula from your best working set, ignoring sets above 12
              reps where the estimate stops tracking real strength. Filled points are new records.
            </p>
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Volume per session</h2>
              <span className="hint">Weight moved</span>
            </div>
            <SessionVolumeChart sessions={data.sessions} units={units} />
          </section>

          {data.records.bestRepsByWeight.length > 0 ? (
            <section className="card">
              <div className="card-title">
                <h2>Rep records</h2>
                <span className="hint">Most reps at each load</span>
              </div>
              <table className="detail-sets">
                <thead>
                  <tr>
                    <th>Weight</th>
                    <th>Reps</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.bestRepsByWeight.map((record) => (
                    <tr key={`${record.weightKg}-${record.achievedAt}`}>
                      <td className="tabular">{formatWeight(record.weightKg, units)}</td>
                      <td className="tabular">{record.reps}</td>
                      <td className="tabular faint">{record.achievedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}

function TrendValue({ trend, units }: { trend: Trend; units: Units }) {
  if (trend.changePercent == null) {
    return (
      <>
        <div className="value" style={{ fontSize: '1.1rem' }}>Not enough data</div>
        <div className="foot">Needs four sessions</div>
      </>
    )
  }

  const tone =
    trend.direction === 'improving' ? 'var(--success)'
      : trend.direction === 'declining' ? 'var(--danger)'
        : 'var(--text)'

  return (
    <>
      <div className="value" style={{ color: tone }}>
        {trend.changePercent > 0 ? '+' : ''}{trend.changePercent}%
      </div>
      {/* The word is what carries the meaning; the colour only reinforces it. */}
      <div className="foot">
        {trend.direction} - {formatWeight(trend.earlierAvg, units, false)} to {formatWeight(trend.recentAvg, units, false)} {units}
      </div>
    </>
  )
}

function OneRepMaxChart({ sessions, units }: { sessions: ExerciseSessionPoint[]; units: Units }) {
  const rows = sessions
    .filter((session) => session.estimatedOneRepMax != null)
    .map((session) => ({
      date: session.date,
      label: shortDate(session.date),
      value: round(toDisplay(session.estimatedOneRepMax, units)),
      top: round(toDisplay(session.topSetWeightKg, units)),
      reps: session.topSetReps,
      isRecord: session.isRecord,
    }))

  if (rows.length < 2) {
    return <p className="muted small">At least two sessions are needed to draw a line.</p>
  }

  return (
    <div className="chart-frame tall">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--axis)"
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickLine={false}
            minTickGap={22}
          />
          <YAxis
            stroke="var(--axis)"
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            domain={['dataMin - 5', 'dataMax + 5']}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as (typeof rows)[number]
              return (
                <div className="viz-tooltip">
                  <div className="head">{row.date}</div>
                  <div className="row">
                    <span>Est. 1RM</span>
                    <b className="tabular">{row.value} {units}</b>
                  </div>
                  <div className="row muted">
                    <span>Top set</span>
                    <span className="tabular">{row.top} x {row.reps}</span>
                  </div>
                  {row.isRecord ? <div className="row" style={{ color: 'var(--success)' }}>New record</div> : null}
                </div>
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--series-1)"
            strokeWidth={2}
            // Record sessions get a filled 8px marker; ordinary ones stay on the line, so the
            // milestones are findable without a number printed on every point.
            dot={(props) => {
              const { key, ...rest } = props as { key?: string } & Record<string, unknown>
              const row = (props as { payload: (typeof rows)[number] }).payload
              if (!row.isRecord) return <g key={key} />
              return (
                <Dot
                  key={key}
                  {...rest}
                  r={4}
                  fill="var(--series-1)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )
            }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SessionVolumeChart({ sessions, units }: { sessions: ExerciseSessionPoint[]; units: Units }) {
  const rows = sessions.map((session) => ({
    date: session.date,
    label: shortDate(session.date),
    value: round(toDisplay(session.volumeKg, units)),
    sets: session.sets,
    reps: session.reps,
  }))

  if (rows.length === 0) return <p className="muted small">No sessions in this period.</p>

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 4, right: 10, bottom: 0, left: -14 }}
          barCategoryGap="20%"
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--axis)"
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickLine={false}
            minTickGap={22}
          />
          <YAxis
            stroke="var(--axis)"
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value))}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as (typeof rows)[number]
              return (
                <div className="viz-tooltip">
                  <div className="head">{row.date}</div>
                  <div className="row">
                    <span>Volume</span>
                    <b className="tabular">{row.value?.toLocaleString()} {units}</b>
                  </div>
                  <div className="row muted">
                    <span>Work</span>
                    <span className="tabular">{row.sets} sets, {row.reps} reps</span>
                  </div>
                </div>
              )
            }}
          />
          <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={30}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function shortDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10
}
