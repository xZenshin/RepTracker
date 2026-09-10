import { useRef, useState } from 'react'
import { useLogin, useRegister } from '../api/hooks'
import { ApiError } from '../api/client'
import { CODE_LENGTH, digitsOnly, formatCode, isWellFormed } from '../lib/loginCode'
import { AlertIcon, CheckIcon, CopyIcon } from '../components/Icons'
import { copyText } from '../lib/clipboard'
import './login.css'

type Mode = 'login' | 'register'

/**
 * `onIssued` hands the new code up to App rather than showing it here, because registering also
 * signs the user in - which unmounts this component. See the note on the gate in App.tsx.
 */
export default function Login({ onIssued }: { onIssued: (code: string) => void }) {
  const [mode, setMode] = useState<Mode>('login')

  return (
    <div className="auth">
      <div className="auth-card">
        <header className="auth-brand">
          <span className="mark">RT</span>
          <div>
            <h1>RepTracker</h1>
            <p className="muted small">Log every set. Watch the numbers move.</p>
          </div>
        </header>

        {mode === 'login' ? (
          <SignIn onSwitch={() => setMode('register')} />
        ) : (
          <SignUp onSwitch={() => setMode('login')} onIssued={onIssued} />
        )}
      </div>
    </div>
  )
}

function SignIn({ onSwitch }: { onSwitch: () => void }) {
  const [code, setCode] = useState('')
  const login = useLogin()

  const digits = digitsOnly(code)
  const complete = digits.length === CODE_LENGTH
  const valid = isWellFormed(digits)

  // Only complain about the check digit once the whole code is in; flagging a half-typed code
  // as wrong is just noise.
  const typo = complete && !valid

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) login.mutate(digits)
      }}
    >
      <label className="field">
        <span className="label">Your access code</span>
        <input
          className="input code-input"
          value={formatCode(code)}
          onChange={(event) => setCode(digitsOnly(event.target.value))}
          placeholder="0000 0000 0000 0000 0000"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-invalid={typo}
        />
        <span className="help">
          {typo ? (
            <span className="error-text">That code has a typo in it - check the digits.</span>
          ) : (
            `${digits.length} of ${CODE_LENGTH} digits`
          )}
        </span>
      </label>

      {login.error ? <p className="banner">{(login.error as ApiError).message}</p> : null}

      <button className="btn primary lg block" type="submit" disabled={!valid || login.isPending}>
        {login.isPending ? 'Checking...' : 'Sign in'}
      </button>

      <button className="btn ghost block" type="button" onClick={onSwitch} style={{ marginTop: 10 }}>
        I need a new account
      </button>
    </form>
  )
}

function SignUp({ onSwitch, onIssued }: { onSwitch: () => void; onIssued: (code: string) => void }) {
  const [displayName, setDisplayName] = useState('')
  const [signupCode, setSignupCode] = useState('')
  const register = useRegister()

  // The instance may be invite-only. Rather than probe for that, the field is always offered and
  // simply left blank when it is not needed.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        register.mutate(
          { displayName: displayName.trim() || undefined, signupCode: signupCode.trim() || undefined },
          { onSuccess: (data) => onIssued(data.loginCode) },
        )
      }}
    >
      <label className="field">
        <span className="label">Name (optional)</span>
        <input
          className="input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="What should we call you?"
          maxLength={40}
          autoFocus
        />
      </label>

      <label className="field">
        <span className="label">Invite code (if you were given one)</span>
        <input
          className="input"
          value={signupCode}
          onChange={(event) => setSignupCode(event.target.value)}
          placeholder="Leave blank if you weren't"
        />
      </label>

      {register.error ? <p className="banner">{(register.error as ApiError).message}</p> : null}

      <button className="btn primary lg block" type="submit" disabled={register.isPending}>
        {register.isPending ? 'Creating...' : 'Create my account'}
      </button>

      <button className="btn ghost block" type="button" onClick={onSwitch} style={{ marginTop: 10 }}>
        I already have a code
      </button>
    </form>
  )
}

/**
 * The one moment the code exists outside the user's own records. It is stored only as a keyed
 * hash, so it genuinely cannot be shown again or recovered by anyone - hence the friction here.
 *
 * Getting the twenty digits off this screen therefore has to work on the first try, on whatever
 * browser the user happens to be holding. Three ways out, in order: the copy button, which falls
 * back through `copyText`; tapping the code, which selects all of it for a press-and-hold copy;
 * and reading it off the screen. The middle one is what `user-select: all` buys: one tap, or one
 * long press, selects the whole code. A readonly input would do the same, but any input small
 * enough to fit twenty digits on a narrow phone is under the 16px that stops iOS zooming on focus.
 */
export function CodeIssued({ code, onDone }: { code: string; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const codeRef = useRef<HTMLDivElement>(null)

  // Only needed when the clipboard is refused - `user-select: all` already selects the whole code
  // on a tap or a long press without any of this.
  const selectAll = () => {
    const node = codeRef.current
    const selection = window.getSelection()
    if (!node || !selection) return

    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <h1>This is your only key</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          There is no email and no password reset. Save these digits somewhere you trust - a
          password manager, or written down.
        </p>

        <div ref={codeRef} className="issued-code mono tabular">
          {formatCode(code)}
        </div>

        <button
          className="btn block"
          type="button"
          onClick={async () => {
            // The digits alone, without the display grouping - though the login field strips
            // non-digits anyway, so a hand-copied code with spaces in it works too.
            const ok = await copyText(code)
            setCopy(ok ? 'copied' : 'failed')
            if (ok) setTimeout(() => setCopy('idle'), 2000)
            else selectAll()
          }}
        >
          {copy === 'copied' ? <CheckIcon className="icon-sm" /> : <CopyIcon className="icon-sm" />}
          {copy === 'copied' ? 'Copied' : 'Copy code'}
        </button>

        {copy === 'failed' ? (
          <p className="banner" style={{ marginTop: 10 }} role="alert">
            <AlertIcon className="icon-sm" style={{ flex: '0 0 auto', marginTop: 1 }} />
            <span>
              This browser would not let the app reach the clipboard. The code above is selected -
              press and hold it and choose Copy, or write it down.
            </span>
          </p>
        ) : (
          <p className="copy-hint">Or tap the code to select it, then copy it by hand.</p>
        )}

        <label className="confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I have saved my code somewhere safe.</span>
        </label>

        <button
          className="btn primary lg block"
          type="button"
          disabled={!confirmed}
          onClick={onDone}
        >
          <CheckIcon className="icon-sm" />
          Start training
        </button>
      </div>
    </div>
  )
}
