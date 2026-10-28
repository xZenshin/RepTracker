import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Bar, BarChart, Brush, CartesianGrid, Dot, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useExerciseStats, useMe, useStatExercises } from '../api/hooks'
import type { ExerciseSessionPoint, Trend, Units } from '../api/types'
import { formatVolume, formatWeight, toDisplay, weightStep } from '../lib/units'
import { formatRelative } from '../lib/time'
import { BackIcon, TrophyIcon } from '../components/Icons'
import ExerciseOutliers from '../components/ExerciseOutliers'
import SessionEditor from '../components/SessionEditor'
import '../styles/viz.css'
import './workout-detail.css'

const PERIODS = [
  { weeks: 13, label: '3M' },
  { weeks: 26, label: '6M' },
  { weeks: 52, label: '12M' },
  { weeks: 156, label: 'All' },
]

export default function ExerciseDetail() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const [weeks, setWeeks] = useState(52)
  // The session picked from a chart for correcting, by workout.
  const [editing, setEditing] = useState<string | null>(null)
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
            {/* From the list too, since a period with nothing logged in it brings no name. */}
            <h1>{data?.exerciseName ?? all?.find((item) => item.id === exerciseId)?.name ?? 'Exercise'}</h1>
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
            onChange={(event) => navigate(`/stats/exercises/${event.target.value}`, { replace: true })}
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

      {/* First, because a mistake here is what makes everything below look wrong. Checked across
          all history, so it shows whatever the period - even one with nothing in it. */}
      {exerciseId ? <ExerciseOutliers exerciseId={exerciseId} units={units} /> : null}

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
            <OneRepMaxChart sessions={data.sessions} units={units} onPick={setEditing} />
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
            <SessionVolumeChart sessions={data.sessions} units={units} onPick={setEditing} />
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
      {editing && exerciseId ? (
        <SessionEditor
          exerciseId={exerciseId}
          workoutId={editing}
          units={units}
          weightStep={weightStep(units, user?.weightStepKg)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </main>
  )
}

/**
 * Every session is one slot across the plot, so a few hundred of them leave a pixel or two each -
 * some none at all - and a session can no longer be hovered or picked. Past this many the chart
 * gets a range slider to narrow it to a stretch where each session has room again.
 */
const BRUSH_FROM = 80

/**
 * What both session charts share: the x axis, the click that picks a session, and the range slider.
 *
 * Sessions are keyed by workout id on the x axis, never by their printed date. Recharts finds the
 * hovered row by matching the axis value, first match wins, so with "12 Jul" in two years every
 * hover in the later year showed the earlier session. Keyed by id, the active label *is* the
 * session, which also holds inside a brushed range where an index would count from its start.
 */
function useSessionChart(rows: { workoutId: string; date: string }[], onPick: (workoutId: string) => void) {
  const [range, setRange] = useState<{ startIndex: number; endIndex: number; count: number } | null>(null)
  // A press that starts on the slider is a drag, and the click it ends in is not a pick.
  const pressedOnBrush = useRef(false)

  const spansYears = rows.length > 1 && rows[0].date.slice(0, 4) !== rows[rows.length - 1].date.slice(0, 4)
  const labels = new Map(rows.map((row) => [row.workoutId, shortDate(row.date, spansYears)]))
  const label = (id: string) => labels.get(id) ?? ''

  // Held here, not left to the Brush: Recharts resets its range whenever the data array changes,
  // so saving a correction - which refetches the sessions - would throw the range away. A range is
  // indexes into one set of rows, so a period with a different number of sessions starts over.
  const kept = range?.count === rows.length ? range : null

  const brush = rows.length > BRUSH_FROM ? (
    <Brush
      dataKey="workoutId"
      height={26}
      travellerWidth={8}
      stroke="var(--border-strong)"
      fill="var(--surface-2)"
      tickFormatter={label}
      ariaLabel="Range of sessions shown"
      startIndex={kept?.startIndex ?? 0}
      endIndex={kept?.endIndex ?? rows.length - 1}
      onChange={({ startIndex, endIndex }) => setRange({ startIndex, endIndex, count: rows.length })}
    />
  ) : null

  return {
    label,
    brush,
    frameClass: brush ? ' brushed' : '',
    onMouseDownCapture: (event: MouseEvent) => {
      pressedOnBrush.current = (event.target as Element).closest('.recharts-brush') != null
    },
    /**
     * Charts take a click anywhere, not just on a dot: it picks the session the tooltip is
     * showing, which is the nearest one. Most 1RM points are not drawn as dots at all.
     */
    onClick: (state: { activeLabel?: string | number } | null) => {
      if (pressedOnBrush.current) return
      // Missing when the click lands before the chart has registered the pointer.
      const id = state?.activeLabel
      if (rows.some((row) => row.workoutId === id)) onPick(id as string)
    },
  }
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

function OneRepMaxChart({
  sessions, units, onPick,
}: { sessions: ExerciseSessionPoint[]; units: Units; onPick: (workoutId: string) => void }) {
  // Memoised: a new array is new data to Recharts, which rebuilds the brush mid-drag.
  const rows = useMemo(() => sessions
    .filter((session) => session.estimatedOneRepMax != null)
    .map((session) => ({
      workoutId: session.workoutId,
      date: session.date,
      value: round(toDisplay(session.estimatedOneRepMax, units)),
      top: round(toDisplay(session.topSetWeightKg, units)),
      reps: session.topSetReps,
      isRecord: session.isRecord,
    })), [sessions, units])
  const chart = useSessionChart(rows, onPick)

  if (rows.length < 2) {
    return <p className="muted small">At least two sessions are needed to draw a line.</p>
  }

  return (
    <div className={`chart-frame tall pickable${chart.frameClass}`} onMouseDownCapture={chart.onMouseDownCapture}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -14 }} onClick={chart.onClick}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="workoutId"
            tickFormatter={chart.label}
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
            // Whole numbers at both ends. 'dataMin - 5' is plain float maths, so 16.1 - 5 gave a
            // 11.100000000000001 floor that every tick stepped up from inherited.
            domain={[(min: number) => Math.floor(min - 5), (max: number) => Math.ceil(max + 5)]}
            allowDecimals={false}
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
                  <div className="hint-row">Click to correct this session</div>
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
          {chart.brush}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SessionVolumeChart({
  sessions, units, onPick,
}: { sessions: ExerciseSessionPoint[]; units: Units; onPick: (workoutId: string) => void }) {
  // Memoised: a new array is new data to Recharts, which rebuilds the brush mid-drag.
  const rows = useMemo(() => sessions.map((session) => ({
    workoutId: session.workoutId,
    date: session.date,
    value: round(toDisplay(session.volumeKg, units)),
    sets: session.sets,
    reps: session.reps,
  })), [sessions, units])
  const chart = useSessionChart(rows, onPick)

  if (rows.length === 0) return <p className="muted small">No sessions in this period.</p>

  return (
    <div className={`chart-frame pickable${chart.frameClass}`} onMouseDownCapture={chart.onMouseDownCapture}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          onClick={chart.onClick}
          margin={{ top: 4, right: 10, bottom: 0, left: -14 }}
          barCategoryGap="20%"
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="workoutId"
            tickFormatter={chart.label}
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
                  <div className="hint-row">Click to correct this session</div>
                </div>
              )
            }}
          />
          <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={30}
            isAnimationActive={false}
            // A bar hit directly is that bar's session, whether or not the chart has seen the pointer.
            // Read from the bar's own row: its index counts from the start of the brushed range.
            onClick={(entry) => {
              const id = (entry.payload as (typeof rows)[number] | undefined)?.workoutId
              if (id) onPick(id)
            }}
          />
          {chart.brush}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function shortDate(date: string, withYear: boolean) {
  return new Date(date).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: withYear ? '2-digit' : undefined,
  })
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10
}
