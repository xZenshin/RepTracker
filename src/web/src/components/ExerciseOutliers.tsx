import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCorrectSets, useOutliers } from '../api/hooks'
import type { Modality, PreviousSet, SessionReview, Units } from '../api/types'
import { ApiError } from '../api/client'
import { formatDate, formatDateFull } from '../lib/time'
import { describeSet } from '../lib/setFields'
import { AlertIcon } from './Icons'
import './exercise-outliers.css'

/**
 * Sessions of this exercise that look like logging mistakes, each with two ways out: adjust the
 * ticked sets to values worked out from the sessions either side, or remove them. Only this
 * exercise's sets in that workout change. Nothing shows when nothing looks wrong.
 */
export default function ExerciseOutliers({ exerciseId, units }: { exerciseId: string; units: Units }) {
  const { data: outliers } = useOutliers(exerciseId)
  const [fixed, setFixed] = useState<string | null>(null)

  if (!outliers || (outliers.length === 0 && !fixed)) return null

  return (
    <section className="card outliers">
      <div className="card-title">
        <h2>Possible logging mistakes</h2>
        <span className="hint">
          {outliers.length} session{outliers.length === 1 ? '' : 's'}
        </span>
      </div>

      {fixed ? <p className="banner info outliers-fixed">{fixed}</p> : null}

      {outliers.length > 0 ? (
        <p className="muted small outliers-lead">
          Each of these is far off from every one of the three sessions before it and after it,
          which is what a typo looks like. Check each one: adjust it to the sessions around it,
          or remove the sets. Nothing else in the workout changes.
        </p>
      ) : null}

      {outliers.map((outlier) => (
        <OutlierCard
          // Keyed on its sets too, so a session still flagged after removing some starts afresh
          // rather than ticking sets that are gone.
          key={`${outlier.workoutExerciseId}:${outlier.sets.map((s) => s.id).join()}`}
          outlier={outlier}
          units={units}
          onFixed={(message) => setFixed(message)}
        />
      ))}
    </section>
  )
}

function OutlierCard({
  outlier, units, onFixed,
}: {
  outlier: SessionReview
  units: Units
  onFixed: (message: string) => void
}) {
  const correct = useCorrectSets()
  const [ticked, setTicked] = useState(() => new Set(outlier.sets.map((s) => s.id)))
  const suggestion = new Map(outlier.suggested.map((s) => [s.setId, s]))
  // With the year: a flagged session can be from any time in the history.
  const day = formatDateFull(outlier.startedAt)

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const chosen = outlier.sets.filter((s) => ticked.has(s.id))
  const count = `${chosen.length} set${chosen.length === 1 ? '' : 's'}`

  function adjust() {
    correct.mutate(
      {
        workoutId: outlier.workoutId,
        workoutExerciseId: outlier.workoutExerciseId,
        update: chosen.map((set) => {
          const s = suggestion.get(set.id)
          return {
            id: set.id,
            weightKg: s?.weightKg ?? set.weightKg,
            reps: s?.reps ?? set.reps,
            durationSeconds: s?.durationSeconds ?? set.durationSeconds,
            distanceM: s?.distanceM ?? set.distanceM,
          }
        }),
      },
      { onSuccess: () => onFixed(`${day}: ${count} adjusted to the sessions around it.`) },
    )
  }

  function remove() {
    correct.mutate(
      { workoutId: outlier.workoutId, workoutExerciseId: outlier.workoutExerciseId, remove: chosen.map((s) => s.id) },
      { onSuccess: () => onFixed(`${day}: ${count} removed.`) },
    )
  }

  return (
    <article className="outlier">
      <header className="outlier-head">
        <h3>
          <AlertIcon className="icon-sm" />
          {day}
        </h3>
        <Link to={`/history/${outlier.workoutId}`} className="small">Open workout</Link>
      </header>

      <Neighbours review={outlier} units={units} />

      <table className="outlier-sets">
        <thead>
          <tr>
            <th aria-label="Include" />
            <th>Set</th>
            <th>Logged</th>
            <th>Adjusted to</th>
          </tr>
        </thead>
        <tbody>
          {outlier.sets.map((set, index) => (
            <tr key={set.id} className={ticked.has(set.id) ? undefined : 'off'}>
              <td>
                <input
                  type="checkbox"
                  checked={ticked.has(set.id)}
                  onChange={() => toggle(set.id)}
                  aria-label={`Include set ${index + 1}`}
                />
              </td>
              <td className="tabular">{index + 1}</td>
              <td className="tabular outlier-logged">{describeSet(set, outlier.modality, units)}</td>
              <td className="tabular">{describeSet(suggestion.get(set.id) ?? set, outlier.modality, units)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {correct.error ? (
        <p className="banner">{correct.error instanceof ApiError ? correct.error.message : 'That did not go through.'}</p>
      ) : null}

      <div className="outlier-actions">
        <button className="btn primary sm" type="button" disabled={chosen.length === 0 || correct.isPending} onClick={adjust}>
          Adjust {count}
        </button>
        <button className="btn danger sm" type="button" disabled={chosen.length === 0 || correct.isPending} onClick={remove}>
          Remove {count}
        </button>
      </div>
    </article>
  )
}

/** The sessions either side, which is what "far off" and the suggested values are measured against. */
export function Neighbours({ review, units }: { review: SessionReview; units: Units }) {
  const sides = [['Before', review.before], ['After', review.after]] as const
  return (
    <dl className="outlier-context">
      {sides.map(([label, side]) => (
        <div key={label}>
          <dt>{label}{side ? ` · ${formatDate(side.startedAt)}` : ''}</dt>
          <dd className="tabular">
            {side ? summarise(side.sets, review.modality, units) : `Nothing ${label === 'Before' ? 'earlier' : 'since'}`}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function summarise(sets: PreviousSet[], modality: Modality, units: Units) {
  return sets.map((s) => describeSet(s, modality, units)).join(', ')
}
