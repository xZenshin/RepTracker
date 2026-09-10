import { useState } from 'react'
import { useDeleteAccount, useLogout, useMe, useUpdateMe } from '../api/hooks'
import type { Units } from '../api/types'
import { toDisplay, toKg } from '../lib/units'
import { formatDateFull } from '../lib/time'
import { AlertIcon } from '../components/Icons'

export default function Settings() {
  const { data: user } = useMe()
  const update = useUpdateMe()
  const logout = useLogout()
  const deleteAccount = useDeleteAccount()

  const units = user?.units ?? 'kg'
  const [name, setName] = useState(user?.displayName ?? '')
  const [bodyWeight, setBodyWeight] = useState(() => {
    const value = toDisplay(user?.bodyWeightKg, units)
    return value === null ? '' : String(Math.round(value * 10) / 10)
  })

  if (!user) return null

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Training since {formatDateFull(user.createdAt)}</p>
        </div>
      </div>

      <section className="card">
        <div className="card-title"><h2>Profile</h2></div>

        <label className="field">
          <span className="label">Display name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() !== (user.displayName ?? '')) {
                update.mutate({ displayName: name.trim() || null })
              }
            }}
            maxLength={40}
            placeholder="Optional"
          />
        </label>

        <div className="field">
          <span className="label">Units</span>
          <div className="segmented">
            {(['kg', 'lb'] as Units[]).map((option) => (
              <button
                key={option}
                className={units === option ? 'on' : ''}
                type="button"
                onClick={() => update.mutate({ units: option })}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="help">
            Everything is stored in kilograms and converted for display, so switching never
            rewrites your history.
          </p>
        </div>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="label">Bodyweight ({units})</span>
          <input
            className="input"
            type="number"
            step="any"
            value={bodyWeight}
            onChange={(event) => setBodyWeight(event.target.value)}
            onBlur={() => {
              const parsed = bodyWeight.trim() === '' ? null : Number(bodyWeight)
              update.mutate({ bodyWeightKg: parsed === null || Number.isNaN(parsed) ? null : toKg(parsed, units) })
            }}
            placeholder="Optional"
          />
          <p className="help">
            Used to give pull-ups, dips and push-ups a real load. Without it those sets count as
            zero volume and no strength estimate.
          </p>
        </label>
      </section>

      <section className="card">
        <div className="card-title"><h2>Your access code</h2></div>
        <p className="muted small">
          Your code is stored only as a keyed hash, so it cannot be shown again or recovered by
          anyone - including whoever runs this server. If you lose it, the account is gone.
        </p>
      </section>

      <section className="card">
        <div className="card-title"><h2>Account</h2></div>

        <button
          className="btn block"
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </button>

        <DangerZone
          onConfirm={() => deleteAccount.mutate()}
          pending={deleteAccount.isPending}
        />
      </section>
    </main>
  )
}

function DangerZone({ onConfirm, pending }: { onConfirm: () => void; pending: boolean }) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button className="btn danger block" type="button" style={{ marginTop: 10 }} onClick={() => setArmed(true)}>
        Delete my account
      </button>
    )
  }

  return (
    <div className="banner" style={{ marginTop: 12, flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
      <span className="row" style={{ alignItems: 'flex-start' }}>
        <AlertIcon className="icon-sm" />
        This erases every workout, routine and custom exercise. It cannot be undone.
      </span>
      <div className="row">
        <button className="btn sm" type="button" onClick={() => setArmed(false)}>Keep my account</button>
        <button
          className="btn danger sm"
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm('Last check: permanently delete everything?')) onConfirm()
          }}
        >
          {pending ? 'Deleting...' : 'Yes, delete everything'}
        </button>
      </div>
    </div>
  )
}
