import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMe, useStatExercises } from '../api/hooks'
import type { ExerciseListItem, MergeSummary } from '../api/types'
import { formatWeight } from '../lib/units'
import { formatDate, formatRelative } from '../lib/time'
import { AlertIcon, SearchIcon, TrophyIcon } from '../components/Icons'
import StatsTabs from '../components/StatsTabs'
import MergeExercises from '../components/MergeExercises'
import '../styles/viz.css'
import './exercise-list.css'

type SortKey = 'name' | 'last' | 'sessions' | 'e1rm' | 'heaviest'
type Filter = 'all' | 'record' | 'stalled'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Exercise' },
  { key: 'last', label: 'Last done', numeric: true },
  { key: 'sessions', label: 'Sessions', numeric: true },
  { key: 'e1rm', label: 'Best est. 1RM', numeric: true },
  { key: 'heaviest', label: 'Heaviest', numeric: true },
]

const sortValue: Record<SortKey, (item: ExerciseListItem) => string | number | null> = {
  name: (item) => item.name.toLowerCase(),
  last: (item) => (item.lastPerformedAt ? Date.parse(item.lastPerformedAt) : null),
  sessions: (item) => item.sessions,
  e1rm: (item) => item.bestOneRepMax ?? null,
  heaviest: (item) => item.bestWeightKg ?? null,
}

export default function ExerciseList() {
  const { data: items, isPending } = useStatExercises()
  const { data: user } = useMe()
  const units = user?.units ?? 'kg'

  // Filters live in the URL, so coming Back from an exercise lands on the same view of the list.
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const filter = (params.get('show') as Filter | null) ?? 'all'
  const group = params.get('group') ?? ''
  const sort = (params.get('sort') as SortKey | null) ?? 'last'
  const descending = (params.get('dir') ?? (sort === 'name' ? 'asc' : 'desc')) === 'desc'

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const all = items ?? []
  const counts = {
    all: all.length,
    record: all.filter((item) => item.status === 'record').length,
    stalled: all.filter((item) => item.status === 'stalled').length,
  }
  const groups = [...new Set(all.map((item) => item.muscleGroup))].sort()

  const needle = query.trim().toLowerCase()
  const rows = all
    .filter((item) => filter === 'all' || item.status === filter)
    .filter((item) => !group || item.muscleGroup === group)
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const x = sortValue[sort](a)
      const y = sortValue[sort](b)
      // Exercises without the value (no strength estimate for cardio, say) sink in either direction.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      const order = x < y ? -1 : x > y ? 1 : 0
      return descending ? -order : order
    })

  // Merging: the rows become tick boxes, and two ticked open the merge sheet. Picked by id, so a
  // search or filter in between keeps what was already ticked.
  const [merging, setMerging] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [merged, setMerged] = useState<MergeSummary | null>(null)
  const pair = picked.map((id) => all.find((item) => item.id === id)).filter((item) => item !== undefined)

  const togglePick = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-2)))

  const stopMerging = () => {
    setMerging(false)
    setPicked([])
    setConfirming(false)
  }

  const toggleSort = (key: SortKey) => {
    if (key === sort) update({ dir: descending ? 'asc' : 'desc' })
    else update({ sort: key === 'last' ? null : key, dir: null })
  }

  return (
    <main className="page viz">
      <div className="page-header">
        <div>
          <h1>Stats</h1>
          <p className="subtitle">Every exercise you have logged, and how it is going.</p>
        </div>
      </div>

      <StatsTabs />

      {isPending ? (
        <div className="skeleton" style={{ height: 420 }} />
      ) : all.length === 0 ? (
        <div className="card empty">
          <h3>No exercises yet</h3>
          <p className="small">Finish a workout with a ticked working set and it will be listed here.</p>
          <Link className="btn primary" to="/" style={{ marginTop: 16 }}>Start training</Link>
        </div>
      ) : (
        <section className="card">
          <div className="exlist-toolbar">
            <label className="exlist-search">
              <SearchIcon className="icon-sm" />
              <input
                className="input"
                type="search"
                placeholder="Search exercises"
                aria-label="Search exercises"
                value={query}
                onChange={(event) => update({ q: event.target.value })}
              />
            </label>

            <select
              className="select"
              aria-label="Muscle group"
              value={group}
              onChange={(event) => update({ group: event.target.value })}
            >
              <option value="">All muscle groups</option>
              {groups.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>

            <div className="segmented">
              {([
                ['all', 'All'],
                ['record', 'New PRs'],
                ['stalled', 'Stalled'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? 'on' : ''}
                  onClick={() => update({ show: value === 'all' ? null : value })}
                >
                  {label} <span className="tabular faint">{counts[value]}</span>
                </button>
              ))}
            </div>

            <button
              className="btn sm exlist-merge-toggle"
              type="button"
              onClick={() => {
                if (merging) stopMerging()
                else {
                  setMerging(true)
                  setMerged(null)
                }
              }}
            >
              {merging ? 'Cancel' : 'Merge exercises'}
            </button>
          </div>

          {merging ? (
            <div className="exlist-mergebar" role="status">
              <span>
                <b>Tick the two exercises to merge.</b>{' '}
                <span className="faint tabular">{pair.length} of 2</span>
              </span>
              <button
                className="btn primary sm"
                type="button"
                disabled={pair.length !== 2}
                onClick={() => setConfirming(true)}
              >
                Merge...
              </button>
            </div>
          ) : null}

          {merged ? (
            <p className="banner info exlist-merged">
              Merged {merged.from} into {merged.into}: {merged.sets} set{merged.sets === 1 ? '' : 's'} moved.
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="muted small exlist-none">
              No exercises match.{' '}
              <button type="button" className="exlist-reset" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            </p>
          ) : (
            <table className="exlist">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={column.numeric ? 'num' : undefined}
                      aria-sort={sort === column.key ? (descending ? 'descending' : 'ascending') : undefined}
                    >
                      <button type="button" onClick={() => toggleSort(column.key)}>
                        {column.label}
                        <span className="exlist-arrow" aria-hidden="true">
                          {sort === column.key ? (descending ? '↓' : '↑') : ''}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className={picked.includes(item.id) ? 'picked' : undefined}>
                    <td>
                      {merging ? (
                        // The label's overlay makes the whole row the tick target, as the link does.
                        <label className="exlist-name exlist-pick">
                          <input
                            type="checkbox"
                            checked={picked.includes(item.id)}
                            onChange={() => togglePick(item.id)}
                          />
                          {item.name}
                        </label>
                      ) : (
                        <Link to={`/stats/exercises/${item.id}`} className="exlist-name">
                          {item.name}
                        </Link>
                      )}
                      <StatusChip item={item} />
                      <div className="faint small">{item.muscleGroup}</div>
                    </td>
                    <td className="num" title={item.lastPerformedAt ? formatDate(item.lastPerformedAt) : undefined}>
                      {item.lastPerformedAt ? formatRelative(item.lastPerformedAt) : '-'}
                    </td>
                    <td className="num">{item.sessions}</td>
                    <td className="num strong">{formatWeight(item.bestOneRepMax, units)}</td>
                    <td className="num">{formatWeight(item.bestWeightKg, units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="faint small exlist-legend">
            <b>New PR</b>: best estimated 1RM beaten in the last 30 days. <b>Stalled</b>: no new best
            in six weeks, despite at least three sessions since.
          </p>
        </section>
      )}

      {confirming && pair.length === 2 ? (
        <MergeExercises
          pair={[pair[0], pair[1]]}
          onClose={() => setConfirming(false)}
          onMerged={(summary) => {
            stopMerging()
            setMerged(summary)
          }}
        />
      ) : null}
    </main>
  )
}

function StatusChip({ item }: { item: ExerciseListItem }) {
  if (item.status === 'record') {
    return (
      <span className="chip success" title={item.bestOneRepMaxAt ? `Set ${formatDate(item.bestOneRepMaxAt)}` : undefined}>
        <TrophyIcon className="icon-xs" /> New PR
      </span>
    )
  }

  if (item.status === 'stalled') {
    return (
      <span className="chip warn" title={item.bestOneRepMaxAt ? `Best unchanged since ${formatDate(item.bestOneRepMaxAt)}` : undefined}>
        <AlertIcon className="icon-xs" /> Stalled
      </span>
    )
  }

  return null
}
