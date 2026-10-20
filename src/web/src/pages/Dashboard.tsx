import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useCalendar, useMe, useOverview } from '../api/hooks'
import type { CalendarDay, MuscleGroupLoad, Units, VolumeSeries } from '../api/types'
import { formatVolume, toDisplay } from '../lib/units'
import { formatHours, formatRelative, isoDate } from '../lib/time'
import { AlertIcon, FlameIcon, TrophyIcon } from '../components/Icons'
import '../styles/viz.css'

// Months for the reader, whole weeks underneath: every statistic here buckets by Monday-start week,
// so each period is the nearest whole number of weeks.
const PERIODS = [
  { weeks: 4, label: '1M', span: 'Last month' },
  { weeks: 13, label: '3M', span: 'Last 3 months' },
  { weeks: 26, label: '6M', span: 'Last 6 months' },
  { weeks: 52, label: '12M', span: 'Last 12 months' },
]

export default function Dashboard() {
  const [weeks, setWeeks] = useState(13)
  const period = PERIODS.find((p) => p.weeks === weeks) ?? PERIODS[1]
  const { data, isPending } = useOverview(weeks)
  const { data: user } = useMe()
  const units = user?.units ?? 'kg'

  return (
    <main className="page viz">
      <div className="page-header">
        <div>
          <h1>Stats</h1>
          <p className="subtitle">Where your training is actually going.</p>
        </div>
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

      {isPending || !data ? (
        <LoadingDashboard />
      ) : data.consistency.totalWorkouts === 0 ? (
        <div className="card empty">
          <h3>Nothing to chart yet</h3>
          <p className="small">Finish a few workouts and this page fills itself in.</p>
          <Link className="btn primary" to="/" style={{ marginTop: 16 }}>Start training</Link>
        </div>
      ) : (
        <>
          <section className="tiles">
            <div className="tile">
              <div className="label"><FlameIcon /> Streak</div>
              <div className="value tabular">{data.consistency.currentWeekStreak}<span style={{ fontSize: '0.9rem', fontWeight: 600 }}> wk</span></div>
              <div className="foot">Best {data.consistency.longestWeekStreak} weeks</div>
            </div>

            <div className="tile">
              <div className="label">Workouts</div>
              <div className="value tabular">{data.totals.workouts}</div>
              <div className="foot">{data.totals.avgWorkoutsPerWeek}/week average</div>
            </div>

            <div className="tile">
              <div className="label">Volume</div>
              <div className="value">{formatVolume(data.totals.volumeKg, units)}</div>
              <div className="foot">{data.totals.sets} sets, {data.totals.reps.toLocaleString()} reps</div>
            </div>

            <div className="tile">
              <div className="label">Time under the bar</div>
              <div className="value">{formatHours(data.totals.durationSeconds)}</div>
              <div className="foot">{period.span.toLowerCase()}</div>
            </div>
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Consistency</h2>
              <span className="hint">{period.span}</span>
            </div>
            <Heatmap weeks={weeks} />
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Volume</h2>
              <span className="hint">Total load lifted each {data.volume.bucket}</span>
            </div>
            <VolumeChart series={data.volume} units={units} />
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Hard sets per muscle group</h2>
              <span className="hint">Weekly average</span>
            </div>
            <MuscleGroups groups={data.muscleGroups} />
          </section>

          <div className="grid cols-2">
            <section className="card">
              <div className="card-title">
                <h2>Recent records</h2>
                <span className="hint">Estimated 1RM</span>
              </div>
              {data.recentRecords.length === 0 ? (
                <p className="muted small">No new records in this period. That happens - check the volume chart.</p>
              ) : (
                <div className="insight-list">
                  {data.recentRecords.slice(0, 8).map((record) => (
                    <Link key={`${record.exerciseId}-${record.achievedAt}`} className="insight-row" to={`/stats/${record.exerciseId}`}>
                      <TrophyIcon className="status-icon" style={{ color: 'var(--success)' }} />
                      <span className="name">{record.exerciseName}</span>
                      <span className="meta">
                        {formatVolume(record.estimatedOneRepMax, units).replace(/ t$/, ' t')}
                        {record.previousBest
                          ? ` (+${Math.round(record.estimatedOneRepMax - record.previousBest)})`
                          : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-title">
                <h2>Worth a look</h2>
                <span className="hint">Stalled or skipped</span>
              </div>

              {data.stalling.length === 0 && data.neglected.length === 0 ? (
                <p className="muted small">Nothing stalled and nothing skipped. Keep going.</p>
              ) : (
                <div className="insight-list">
                  {data.stalling.map((item) => (
                    <Link key={item.exerciseId} className="insight-row" to={`/stats/${item.exerciseId}`}>
                      <AlertIcon className="status-icon" style={{ color: 'var(--warn)' }} />
                      <span className="name">
                        {item.exerciseName}
                        <span className="faint small"> stalled</span>
                      </span>
                      <span className="meta">{item.weeksSinceBest}w, {item.sessionsSinceBest} sessions</span>
                    </Link>
                  ))}

                  {data.neglected.map((item) => (
                    <Link key={item.exerciseId} className="insight-row" to={`/stats/${item.exerciseId}`}>
                      <AlertIcon className="status-icon" style={{ color: 'var(--text-faint)' }} />
                      <span className="name">
                        {item.exerciseName}
                        <span className="faint small"> skipped in {item.source}</span>
                      </span>
                      <span className="meta">
                        {item.daysSince > 3650 ? 'never' : formatRelative(item.lastPerformedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-title">
              <h2>Balance</h2>
              <span className="hint">Working sets by movement</span>
            </div>
            <BalanceBars balance={data.balance} />
          </section>
        </>
      )}
    </main>
  )
}

function VolumeChart({ series, units }: { series: VolumeSeries; units: Units }) {
  const daily = series.bucket === 'day'
  const average = `${series.rollingPoints}-${series.bucket} average`

  const rows = series.points.map((point) => {
    // A date-only string parses as UTC midnight, which is the previous day west of Greenwich.
    const date = new Date(`${point.start}T00:00`)
    return {
      start: point.start,
      label: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      heading: daily
        ? date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
        : `Week of ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
      volume: Math.round(toDisplay(point.volumeKg, units) ?? 0),
      rolling: Math.round(toDisplay(point.volumeRolling, units) ?? 0),
      workouts: point.workouts,
      sets: point.sets,
    }
  })

  return (
    <>
      {/* Two series, so identity never rests on colour alone. */}
      <div className="viz-legend">
        <span><i style={{ background: 'var(--series-1)' }} /> {daily ? 'Daily' : 'Weekly'} volume</span>
        <span><i className="line" style={{ background: 'var(--series-2)' }} /> {average}</span>
      </div>

      <div className="chart-frame">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 4, right: 6, bottom: 0, left: -12 }}
            /* Guarantees a surface gap between bars even at phone width, where the category
               band gets narrow enough that maxBarSize alone would let them touch. */
            barCategoryGap="20%"
          >
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--axis)"
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickLine={false}
              minTickGap={18}
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
                    <div className="head">{row.heading}</div>
                    <div className="row">
                      <span><i className="swatch" style={{ background: 'var(--series-1)', display: 'inline-block', marginRight: 6 }} />Volume</span>
                      <b className="tabular">{row.volume.toLocaleString()} {units}</b>
                    </div>
                    <div className="row">
                      <span><i className="swatch" style={{ background: 'var(--series-2)', display: 'inline-block', marginRight: 6 }} />{series.rollingPoints}-{series.bucket} avg</span>
                      <b className="tabular">{row.rolling.toLocaleString()} {units}</b>
                    </div>
                    <div className="row muted">
                      <span>Sessions</span>
                      <span className="tabular">{row.workouts} ({row.sets} sets)</span>
                    </div>
                  </div>
                )
              }}
            />
            {/* Rounded top, anchored to the baseline; the gap comes from barCategoryGap. Daily bars
                over three months are a few pixels wide, too narrow for a 4px radius. */}
            <Bar dataKey="volume" fill="var(--series-1)" radius={daily ? [2, 2, 0, 0] : [4, 4, 0, 0]} maxBarSize={34}
            isAnimationActive={false}
          />
            <Line
              type="monotone"
              dataKey="rolling"
              stroke="var(--series-2)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function MuscleGroups({ groups }: { groups: MuscleGroupLoad[] }) {
  const trained = groups.filter((group) => group.sets > 0)
  const untrained = groups.filter((group) => group.sets === 0)

  // The target band, in hard sets a week.
  const bandLow = 4
  const bandHigh = 8

  // A fixed ceiling half again above the band keeps it in the same place on every row, so the bars
  // can be compared to each other and to the band at a glance.
  const scaleMax = Math.max(bandHigh * 1.5, ...trained.map((g) => g.setsPerWeek))
  const pct = (value: number) => `${Math.min(100, (value / scaleMax) * 100)}%`

  if (trained.length === 0) {
    return <p className="muted small">No working sets logged in this period.</p>
  }

  return (
    <>
      <div className="muscle-rows">
        {trained.map((group) => (
          <div key={group.muscleGroup} className="muscle-row">
            <span className="faint">{group.muscleGroup}</span>
            <div className="muscle-track">
              <div className="muscle-band" style={{ left: pct(bandLow), width: `calc(${pct(bandHigh)} - ${pct(bandLow)})` }} />
              <div className="muscle-fill" style={{ width: pct(group.setsPerWeek) }} />
            </div>
            <span className="value">
              {group.setsPerWeek}
              <span className="faint">/wk</span>
            </span>
          </div>
        ))}
      </div>

      <p className="faint small" style={{ marginTop: 12 }}>
        The shaded band is {bandLow}-{bandHigh} hard sets a week. Warm-ups and cardio are excluded.
        {untrained.length > 0 ? ` Untrained this period: ${untrained.map((g) => g.muscleGroup).join(', ')}.` : ''}
      </p>
    </>
  )
}

function BalanceBars({ balance }: { balance: import('../api/types').Balance }) {
  const rows = [
    { label: 'Push', value: balance.pushSets },
    { label: 'Pull', value: balance.pullSets },
    { label: 'Legs', value: balance.legSets },
    { label: 'Core', value: balance.coreSets },
    { label: 'Cardio', value: balance.cardioSets },
  ].filter((row) => row.value > 0)

  const max = Math.max(1, ...rows.map((r) => r.value))

  return (
    <>
      <div className="muscle-rows">
        {rows.map((row) => (
          <div key={row.label} className="muscle-row">
            <span className="faint">{row.label}</span>
            <div className="muscle-track">
              <div className="muscle-fill" style={{ width: `${(row.value / max) * 100}%` }} />
            </div>
            <span className="value">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
        {balance.pushPullRatio != null ? (
          <span className={`chip ${ratioTone(balance.pushPullRatio, 0.8, 1.25)}`}>
            Push : pull {balance.pushPullRatio.toFixed(2)}
          </span>
        ) : null}
        {balance.upperLowerRatio != null ? (
          <span className={`chip ${ratioTone(balance.upperLowerRatio, 1, 2.5)}`}>
            Upper : lower {balance.upperLowerRatio.toFixed(2)}
          </span>
        ) : null}
      </div>

      <p className="faint small" style={{ marginTop: 10 }}>
        Roughly even push and pull keeps the shoulders happy. Far more upper than lower usually
        means leg day is the one being skipped.
      </p>
    </>
  )
}

/** The same period as the rest of the page: one column per week, ending with the current one. */
function Heatmap({ weeks: weekCount }: { weeks: number }) {
  const { data: days, isPending } = useCalendar(weekCount)

  if (isPending) return <div className="skeleton" style={{ height: 110 }} />

  const byDate = new Map((days ?? []).map((day) => [day.date, day]))
  const weeks = buildCalendarGrid(byDate, weekCount)

  // A label on the first column of each month; without them a year of squares is unnavigable.
  // A label needs two columns of room, so when a month starts right after the previous label -
  // only possible at the very start of the range - the new month's label replaces it.
  const months: { index: number; label: string }[] = []
  weeks.forEach((week, index) => {
    const date = new Date(week[0].date)
    if (index > 0 && date.getMonth() === new Date(weeks[index - 1][0].date).getMonth()) return
    if (months.length > 0 && index - months[months.length - 1].index < 2) months.pop()
    months.push({ index, label: date.toLocaleDateString(undefined, { month: 'short' }) })
  })

  return (
    <>
      <div className="heatmap-scroll">
        <div className="heatmap-wrap" style={{ '--weeks': weeks.length } as CSSProperties}>
          <div className="heatmap-months">
            {months.map((month) => (
              <span key={month.index} style={{ gridColumn: month.index + 1 }}>{month.label}</span>
            ))}
          </div>

          <div className="heatmap">
            {weeks.flat().map((cell) => (
              <div
                key={cell.date}
                className={`heat-cell${cell.trained ? ' on' : ''}`}
                title={`${cell.date}: ${cell.trained ? 'workout' : 'rest'}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="heat-legend">
        <span className="heat-cell" />
        Rest
        <span className="heat-cell on" style={{ marginLeft: 8 }} />
        Workout
      </div>
    </>
  )
}

interface Cell {
  date: string
  trained: boolean
}

/**
 * `weekCount` whole weeks of seven days, Monday-first, ending with the current week. Each day is
 * simply trained or not: consistency is about showing up, so a short session counts the same as
 * a long one.
 */
function buildCalendarGrid(byDate: Map<string, CalendarDay>, weekCount: number): Cell[][] {
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  // Sunday of the current week, so the final column is always complete.
  const end = new Date(today)
  end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1))

  const start = new Date(end)
  start.setDate(start.getDate() - weekCount * 7 + 1)

  const weeks: Cell[][] = []
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = isoDate(cursor)
    const cell: Cell = { date, trained: (byDate.get(date)?.workouts ?? 0) > 0 }

    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([])
    weeks[weeks.length - 1].push(cell)
  }

  return weeks
}

function ratioTone(value: number, low: number, high: number) {
  return value >= low && value <= high ? 'success' : 'warn'
}

function LoadingDashboard() {
  return (
    <>
      <div className="tiles">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
      </div>
      <div className="skeleton" style={{ height: 300, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 260 }} />
    </>
  )
}
