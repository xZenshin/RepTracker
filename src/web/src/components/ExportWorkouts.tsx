import { useState } from 'react'
import { ApiError, utcOffsetMinutes } from '../api/client'
import { AlertIcon, CheckIcon } from './Icons'

/**
 * Downloads every finished workout as CSV, in the format the import reads. Fetched rather than linked,
 * so a refusal - the rate limit, say - shows up here as a message instead of downloading an error
 * page under a .csv name.
 */
export default function ExportWorkouts() {
  const [state, setState] = useState<{ status: 'idle' | 'pending' } | { status: 'done'; name: string } | { status: 'error'; message: string }>({ status: 'idle' })

  const download = async () => {
    setState({ status: 'pending' })
    try {
      const zone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '')
      const response = await fetch(`/api/export/workouts?timeZone=${zone}&offsetMinutes=${utcOffsetMinutes()}`, {
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const message = response.status === 429
          ? 'Too many exports in a short time. Try again in a few minutes.'
          : `The export failed (${response.status}). Try again.`
        throw new ApiError(response.status, message)
      }

      const name = /filename="?([^";]+)"?/.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
        ?? 'reptracker-export.csv'
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setState({ status: 'done', name })
    } catch (error) {
      setState({ status: 'error', message: error instanceof ApiError ? error.message : 'The export failed. Check your connection and try again.' })
    }
  }

  return (
    <section className="card">
      <div className="card-title"><h2>Export workouts</h2></div>

      <p className="muted small">
        Every finished workout as a CSV file, one row per set, in the same format the import reads.
        Each date carries the time the workout started, so importing the file back adds nothing twice.
      </p>

      <button className="btn" type="button" style={{ marginTop: 14 }} onClick={() => void download()} disabled={state.status === 'pending'}>
        {state.status === 'pending' ? 'Preparing...' : 'Download CSV'}
      </button>

      {state.status === 'done' ? (
        <p className="faint small" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckIcon className="icon-sm" /> Downloaded {state.name}
        </p>
      ) : null}

      {state.status === 'error' ? (
        <p className="banner" style={{ marginTop: 12 }}><AlertIcon className="icon-sm" />{state.message}</p>
      ) : null}
    </section>
  )
}
