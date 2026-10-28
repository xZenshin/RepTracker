import { useState } from 'react'
import { useMergeExercises, useMergePreview } from '../api/hooks'
import type { ExerciseListItem, MergeSummary } from '../api/types'
import { ApiError } from '../api/client'
import { formatRelative } from '../lib/time'
import Sheet from './Sheet'
import './merge-exercises.css'

/**
 * Folds one of two exercises into the other. Nothing is preselected: which name survives is the
 * whole decision, and the server's preview of what will move is shown before anything does.
 */
export default function MergeExercises({
  pair, onClose, onMerged,
}: {
  pair: [ExerciseListItem, ExerciseListItem]
  onClose: () => void
  onMerged: (summary: MergeSummary) => void
}) {
  const [keepId, setKeepId] = useState<string | null>(null)
  const keep = pair.find((item) => item.id === keepId)
  const drop = pair.find((item) => item.id !== keepId)

  const preview = useMergePreview(keep ? drop?.id : undefined, keep?.id)
  const merge = useMergeExercises()
  const summary = preview.data

  return (
    <Sheet
      title="Merge exercises"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          type="button"
          disabled={!keep || !drop || !summary || merge.isPending}
          onClick={() => {
            if (!keep || !drop) return
            merge.mutate({ fromId: drop.id, intoId: keep.id }, { onSuccess: onMerged })
          }}
        >
          {merge.isPending ? 'Merging...' : keep ? `Merge into ${keep.name}` : 'Pick the one to keep'}
        </button>
      }
    >
      <p className="muted small merge-lead">
        Which one do you keep? The other one&apos;s history moves into it, and it goes.
      </p>

      <div className="merge-choices" role="radiogroup" aria-label="Exercise to keep">
        {pair.map((item) => {
          const kept = item.id === keepId
          return (
            <button
              key={item.id}
              className="merge-choice"
              type="button"
              role="radio"
              aria-checked={kept}
              onClick={() => setKeepId(item.id)}
            >
              <span className="merge-choice-state">
                {keepId === null ? 'Keep this one' : kept ? 'Kept' : 'Merged away'}
              </span>
              <strong>{item.name}</strong>
              <span className="faint small">
                {item.muscleGroup} · {item.sessions} session{item.sessions === 1 ? '' : 's'}
                {item.lastPerformedAt ? ` · last ${formatRelative(item.lastPerformedAt)}` : ''}
              </span>
            </button>
          )
        })}
      </div>

      {keep && preview.isPending ? <div className="skeleton merge-skeleton" /> : null}

      {preview.error ? (
        <p className="banner">{preview.error instanceof ApiError ? preview.error.message : 'Could not check that merge.'}</p>
      ) : null}

      {summary ? (
        <ul className="merge-summary">
          <li>
            {summary.sets} set{summary.sets === 1 ? '' : 's'} from {summary.workouts} workout
            {summary.workouts === 1 ? '' : 's'} move to <b>{summary.into}</b>.
          </li>
          {summary.combined > 0 ? (
            <li>
              {summary.combined === summary.workouts
                ? summary.workouts === 1 ? 'That workout' : 'All of them'
                : `${summary.combined} of them`}{' '}
              already had {summary.into}. The sets are combined under it, in the order they were done.
            </li>
          ) : null}
          {summary.routines > 0 ? (
            <li>
              {summary.routines} routine{summary.routines === 1 ? '' : 's'} switch to {summary.into}.
            </li>
          ) : null}
          <li>
            {summary.hidden
              ? `${summary.from} is a built-in exercise, so it is hidden from your lists rather than deleted.`
              : `${summary.from} is deleted.`}{' '}
            A workout or import that still names it lands on {summary.into}.
          </li>
          <li className="merge-final">This cannot be undone.</li>
        </ul>
      ) : null}

      {merge.error ? (
        <p className="banner">{merge.error instanceof ApiError ? merge.error.message : 'The merge did not go through.'}</p>
      ) : null}
    </Sheet>
  )
}
