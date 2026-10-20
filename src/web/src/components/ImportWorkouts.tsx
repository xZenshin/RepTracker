import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useImportWorkouts } from '../api/hooks'
import { ApiError } from '../api/client'
import type { ImportSummary, Modality, Units } from '../api/types'
import { AlertIcon, CheckIcon } from './Icons'
import './import-workouts.css'

const MAX_BYTES = 2 * 1024 * 1024

const MODALITY: Record<Modality, string> = {
  WeightReps: 'weight and reps',
  BodyweightReps: 'bodyweight reps',
  Duration: 'timed',
  DistanceDuration: 'distance',
}

/**
 * Imports workouts from a spreadsheet saved as CSV, one row per set. Choosing a file only previews
 * it - the server checks every row and says what it would add - and nothing is written until the
 * import is confirmed. A file with any error in it imports nothing.
 */
export default function ImportWorkouts({ units }: { units: Units }) {
  const run = useImportWorkouts()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null)
  const [tooBig, setTooBig] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)

  const reset = () => {
    setFile(null)
    setResult(null)
    setTooBig(false)
    run.reset()
    if (input.current) input.current.value = ''
  }

  const choose = async (picked: File | undefined) => {
    if (!picked) return
    setResult(null)
    run.reset()
    if (picked.size > MAX_BYTES) {
      setFile(null)
      setTooBig(true)
      return
    }
    setTooBig(false)
    const csv = await picked.text()
    setFile({ name: picked.name, csv })
    run.mutate({ csv, commit: false }, { onSuccess: setResult })
  }

  const preview = result && !result.committed ? result : null
  const done = result?.committed ? result : null

  return (
    <section className="card">
      <div className="card-title"><h2>Import workouts</h2></div>

      <p className="muted small">
        Bring in training from a spreadsheet: one row per set, saved as CSV. Rows with the same date
        and workout name become one workout. Weights are read in {units}, your unit setting, unless a
        cell says otherwise, like <span className="mono">225 lb</span>.
      </p>

      <div className="row wrap import-actions">
        <button className="btn" type="button" onClick={() => downloadTemplate(units)}>
          Download the template
        </button>
        <label className="btn primary import-pick">
          {file && !done ? 'Choose another file' : 'Choose a CSV file'}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
      </div>

      <details className="import-columns">
        <summary>What goes in each column</summary>
        <table>
          <tbody>
            <tr><th>date</th><td>Required. <span className="mono">2026-08-14</span>, or <span className="mono">2026-08-14 07:30</span> with a time. <span className="mono">14.08.2026</span> works too.</td></tr>
            <tr><th>exercise</th><td>Required. Matched by name to your exercise list; a name it does not know becomes a new custom exercise.</td></tr>
            <tr><th>workout</th><td>The workout's name, like Push A.</td></tr>
            <tr><th>weight</th><td>The load. For pull-ups and dips, the weight added to your body.</td></tr>
            <tr><th>reps</th><td>Reps in the set. A set needs reps or a duration.</td></tr>
            <tr><th>duration</th><td>For timed sets such as a plank: seconds, or <span className="mono">1:30</span>.</td></tr>
            <tr><th>warmup</th><td><span className="mono">yes</span> for a warm-up set, which stats leave out.</td></tr>
            <tr><th>muscle group</th><td>Only used when an exercise is new, so its sets count in the right place.</td></tr>
            <tr><th>workout minutes</th><td>How long the workout took. On any one row of it is enough.</td></tr>
          </tbody>
        </table>
      </details>

      {tooBig ? (
        <p className="banner import-panel"><AlertIcon className="icon-sm" />That file is over 2 MB. Split it into smaller files and import them one at a time.</p>
      ) : null}

      {run.isPending ? (
        <p className="muted small import-panel">{run.variables?.commit ? 'Importing...' : `Checking ${file?.name}...`}</p>
      ) : null}

      {run.error ? (
        <p className="banner import-panel"><AlertIcon className="icon-sm" />{(run.error as ApiError).message}</p>
      ) : null}

      {preview && !run.isPending ? (
        <Preview
          name={file?.name ?? ''}
          summary={preview}
          onImport={() => file && run.mutate({ csv: file.csv, commit: true }, { onSuccess: setResult })}
          onCancel={reset}
        />
      ) : null}

      {done ? (
        <div className="banner info import-panel import-done">
          <CheckIcon className="icon-sm" />
          <span>
            Imported {done.workouts} workout{done.workouts === 1 ? '' : 's'} and {done.sets.toLocaleString()} sets.{' '}
            <Link to="/history">See them in History</Link>
          </span>
        </div>
      ) : null}
    </section>
  )
}

function Preview({ name, summary, onImport, onCancel }: {
  name: string
  summary: ImportSummary
  onImport: () => void
  onCancel: () => void
}) {
  if (summary.errorCount > 0) {
    return (
      <div className="import-panel import-errors">
        <p>
          <b>{name}</b> has {summary.errorCount} problem{summary.errorCount === 1 ? '' : 's'}. Nothing
          has been imported. Fix {summary.errorCount === 1 ? 'it' : 'them'} in the file and choose it again.
        </p>
        <ul>
          {summary.errors.map((error, index) => (
            <li key={index}>
              <span className="import-line">{error.line > 0 ? `Row ${error.line}` : 'File'}</span>
              {error.message}
            </li>
          ))}
        </ul>
        {summary.errorCount > summary.errors.length ? (
          <p className="faint small">And {summary.errorCount - summary.errors.length} more.</p>
        ) : null}
      </div>
    )
  }

  if (summary.workouts === 0) {
    return (
      <div className="import-panel">
        <p className="muted">
          {summary.duplicates > 0
            ? `Every workout in ${name} is already in your history. There is nothing new to import.`
            : `${name} has no sets in it.`}
        </p>
        <button className="btn sm" type="button" onClick={onCancel} style={{ marginTop: 10 }}>Done</button>
      </div>
    )
  }

  return (
    <div className="import-panel import-preview">
      <p className="import-headline">
        {summary.workouts.toLocaleString()} workout{summary.workouts === 1 ? '' : 's'},{' '}
        {summary.sets.toLocaleString()} sets
      </p>
      <p className="muted small">
        {formatDay(summary.from)}
        {summary.to && summary.to !== summary.from ? ` to ${formatDay(summary.to)}` : ''}
      </p>

      <ul className="import-facts">
        <li>
          {summary.matchedExercises} exercise{summary.matchedExercises === 1 ? '' : 's'} matched to your list.
        </li>
        {summary.renamed.length > 0 ? (
          <li>
            Matched under a different name:{' '}
            {summary.renamed.map((pair, index) => (
              <span key={pair.from}>
                {index > 0 ? ', ' : ''}{pair.from} <span aria-hidden="true">→</span><span className="sr-only">as</span> <b>{pair.to}</b>
              </span>
            ))}
            . If one is wrong, rename it in the file.
          </li>
        ) : null}
        {summary.newExercises.length > 0 ? (
          <li>
            {summary.newExercises.length} new exercise{summary.newExercises.length === 1 ? '' : 's'} will be created:{' '}
            {summary.newExercises.map((exercise, index) => (
              <span key={exercise.name}>
                {index > 0 ? ', ' : ''}<b>{exercise.name}</b> ({exercise.muscleGroup === 'Other' ? 'no muscle group' : exercise.muscleGroup}, {MODALITY[exercise.modality]})
              </span>
            ))}
            .
          </li>
        ) : null}
        {summary.duplicates > 0 ? (
          <li>{summary.duplicates} workout{summary.duplicates === 1 ? ' is' : 's are'} already in your history and will be skipped.</li>
        ) : null}
      </ul>

      <div className="row wrap" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" onClick={onImport}>
          Import {summary.workouts.toLocaleString()} workout{summary.workouts === 1 ? '' : 's'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function formatDay(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(`${iso}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * A filled-in example to overwrite. The first line tells Excel which separator to split on, so it
 * opens in columns in a European locale too; the importer skips it. No byte-order mark: Excel shows
 * the separator line as text when there is one, and the template is plain ASCII anyway.
 */
function downloadTemplate(units: Units) {
  const w = units === 'lb' ? { warm: 95, work: 135, squat: 225, sled: 265 } : { warm: 40, work: 60, squat: 100, sled: 120 }
  const lines = [
    'sep=,',
    'date,workout,exercise,weight,reps,duration,warmup,muscle group,workout minutes',
    `2026-08-14 07:30,Push A,Barbell Bench Press,${w.warm},10,,yes,,65`,
    `2026-08-14 07:30,Push A,Barbell Bench Press,${w.work},8,,,,`,
    `2026-08-14 07:30,Push A,Barbell Bench Press,${w.work},8,,,,`,
    '2026-08-14 07:30,Push A,Pull-Up,,8,,,,',
    '2026-08-14 07:30,Push A,Plank,,,1:00,,,',
    `2026-08-16,Legs,Back Squat,${w.squat},5,,,,50`,
    `2026-08-16,Legs,Back Squat,${w.squat},5,,,,`,
    `2026-08-16,Legs,Sled Push,${w.sled},10,,,Quads,`,
  ]

  const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'reptracker-import-template.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
