import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useImportWorkouts } from '../api/hooks'
import { ApiError } from '../api/client'
import type { ImportNewExercise, ImportSummary, Units } from '../api/types'
import { AlertIcon, CheckIcon } from './Icons'
import './import-workouts.css'

const MAX_BYTES = 2 * 1024 * 1024

/**
 * Imports a workout log exported as CSV, one row per set, in the
 * `Date,Exercise,Set #,Reps,Weight,Duration,Distance,Resistance,Notes` format. Choosing a file only
 * previews it - the server checks every row and says what it would add - and nothing is written
 * until the import is confirmed. A file with any error in it imports nothing.
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
        Bring in a workout log exported as CSV, one row per set. Every set on the same date becomes one
        workout. Weights are read in {units}, your unit setting.
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
        <p className="faint small import-header">
          The first row names the columns: <span className="mono">Date,Exercise,Set #,Reps,Weight,Duration,Distance,Resistance,Notes</span>
        </p>
        <table>
          <tbody>
            <tr><th>Date</th><td>Required. <span className="mono">17-Aug-2023</span> or <span className="mono">2023-08-17</span>. Add a time, like <span className="mono">2023-08-17 07:30</span>, to log two workouts on one day.</td></tr>
            <tr><th>Exercise</th><td>Required. Matched by name to your exercise list. A name it does not know becomes a new exercise, with its muscle group guessed from the name.</td></tr>
            <tr><th>Set #</th><td>Optional. Sets are kept in the order of the rows.</td></tr>
            <tr><th>Reps</th><td>Required. A set with 0 reps was never done, and is skipped.</td></tr>
            <tr><th>Weight</th><td>The load. 0 for a bodyweight exercise like pull-ups; for weighted dips, the weight added.</td></tr>
            <tr><th>Duration</th><td>For timed sets such as a plank: seconds, or <span className="mono">1:30</span>. 0 when the set is not timed.</td></tr>
            <tr><th>Distance, Resistance</th><td>Read past.</td></tr>
            <tr><th>Notes</th><td>Kept as the note on that exercise in that workout.</td></tr>
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
            Imported {done.workouts.toLocaleString()} workout{done.workouts === 1 ? '' : 's'} and {done.sets.toLocaleString()} sets.{' '}
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

  const names = Object.entries(summary.workoutNames)
  const groups = groupByMuscle(summary.newExercises)

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
        {names.length > 0 ? (
          <li>
            Named from what was trained: {names.map(([label, count]) => `${count.toLocaleString()} ${label}`).join(', ')}.
          </li>
        ) : null}
        <li>
          {summary.matchedExercises} exercise{summary.matchedExercises === 1 ? '' : 's'} matched to your list
          {summary.renamed.length > 0 ? (
            <>
              , {summary.renamed.length} of them under a slightly different name:{' '}
              {summary.renamed.map((pair, index) => (
                <span key={pair.from}>
                  {index > 0 ? ', ' : ''}{pair.from} <span aria-hidden="true">→</span><span className="sr-only">as</span> <b>{pair.to}</b>
                </span>
              ))}
            </>
          ) : null}
          .
        </li>
        {summary.correctedDates.length > 0 ? (
          <li>
            Moved back a year, because the export wrote these late-December dates with the next year's
            number:{' '}
            {summary.correctedDates.map((date, index) => (
              <span key={date.written}>
                {index > 0 ? ', ' : ''}{formatDay(date.written)} <span aria-hidden="true">→</span><span className="sr-only">to</span> <b>{formatDay(date.corrected)}</b>
              </span>
            ))}
            .
          </li>
        ) : null}
        {summary.emptySets > 0 ? (
          <li>{summary.emptySets.toLocaleString()} set{summary.emptySets === 1 ? '' : 's'} with 0 reps will be skipped as never done.</li>
        ) : null}
        {summary.duplicates > 0 ? (
          <li>{summary.duplicates} workout{summary.duplicates === 1 ? ' is' : 's are'} already in your history and will be skipped.</li>
        ) : null}
      </ul>

      {groups.length > 0 ? (
        <div className="import-new">
          <p className="small">
            <b>{summary.newExercises.length} new exercise{summary.newExercises.length === 1 ? '' : 's'}</b>, filed by
            the muscle group guessed from each name. Check them now: a custom exercise's muscle group cannot be
            changed after the import. If one is wrong, rename it in the file to a name from your exercise list.
          </p>
          <table>
            <tbody>
              {groups.map(([group, exercises]) => (
                <tr key={group}>
                  <th>{group === 'Other' ? 'No guess' : group}</th>
                  <td>{exercises.map((e) => e.name).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="row wrap" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" onClick={onImport}>
          Import {summary.workouts.toLocaleString()} workout{summary.workouts === 1 ? '' : 's'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Muscle groups in the order the server sent them, which puts "no guess" last. */
function groupByMuscle(exercises: ImportNewExercise[]): [string, ImportNewExercise[]][] {
  const map = new Map<string, ImportNewExercise[]>()
  for (const exercise of exercises) map.set(exercise.muscleGroup, [...(map.get(exercise.muscleGroup) ?? []), exercise])
  return [...map.entries()]
}

function formatDay(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(`${iso}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * A filled-in example in the import format. The first line tells Excel which separator to split on,
 * so it opens in columns in a European locale too; the importer skips it. No byte-order mark: Excel
 * shows the separator line as text when there is one, and the template is plain ASCII anyway.
 */
function downloadTemplate(units: Units) {
  const w = units === 'lb' ? { bench: 135, fly: 25, squat: 225 } : { bench: 60, fly: 12, squat: 100 }
  const lines = [
    'sep=,',
    'Date,Exercise,Set #,Reps,Weight,Duration,Distance,Resistance,Notes',
    `17-Aug-2023,Barbell Bench Press,1,10,${w.bench},0,,,`,
    `17-Aug-2023,Barbell Bench Press,2,10,${w.bench},0,,,`,
    `17-Aug-2023,Barbell Bench Press,3,8,${w.bench},0,,,Last set was hard`,
    `17-Aug-2023,Incline Cable Flyes,1,12,${w.fly},0,,,`,
    `17-Aug-2023,Incline Cable Flyes,2,10,${w.fly},0,,,`,
    '17-Aug-2023,Pull-Up,1,8,0,0,,,',
    '17-Aug-2023,Plank,1,0,0,60,,,',
    `19-Aug-2023,Back Squat,1,5,${w.squat},0,,,`,
    `19-Aug-2023,Back Squat,2,5,${w.squat},0,,,`,
  ]

  const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'reptracker-import-template.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
