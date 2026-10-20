import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Mode } from './Login'
import { AlertIcon, CheckIcon, TrophyIcon } from '../components/Icons'
import '../styles/viz.css'
import './landing.css'

type Tone = 'red' | 'blue' | 'yellow' | 'green' | 'white'

interface Feature {
  tone: Tone
  /** Seen edge-on on the bar: thickness and diameter in px, as the real plate would be. */
  plate: { thick: number; wide: number }
  title: string
  body: string
  mock: ReactNode
}

// Loaded the way a bar is loaded: heaviest plate first, so the feature that matters most sits at
// the top. Competition colours - red 25, blue 20, yellow 15, green 10, white 5, red 2.5 - and the
// change plates are smaller across as well as thinner.
const FEATURES: Feature[] = [
  {
    tone: 'red',
    plate: { thick: 30, wide: 132 },
    title: 'Log a set with one thumb',
    body: 'The workout screen shows one exercise at a time, with big buttons for weight and reps. Tick the set and it is saved. No keyboard, no tiny fields, nothing to fiddle with between breaths.',
    mock: <LogSetMock />,
  },
  {
    tone: 'blue',
    plate: { thick: 26, wide: 132 },
    title: 'Starts where you left off',
    body: 'Every exercise opens on the sets you did last time, warm-ups included. Beat the numbers on screen, or match them on a heavy day.',
    mock: <CarryOverMock />,
  },
  {
    tone: 'yellow',
    plate: { thick: 22, wide: 132 },
    title: 'A rest timer that survives a locked phone',
    body: 'The countdown runs on the clock rather than the screen, so it is still right when you unlock. Add or take off 15 seconds. When rest is over it shows Go and stays quiet, so nothing cuts into your music.',
    mock: <RestMock />,
  },
  {
    tone: 'green',
    plate: { thick: 18, wide: 132 },
    title: 'See where your training is going',
    body: 'On a computer, the stats page charts your volume by day or week, marks every day you trained, and counts hard sets per muscle group. Pick the last month or the last year.',
    mock: <StatsMock />,
  },
  {
    tone: 'white',
    plate: { thick: 16, wide: 96 },
    title: 'Know which lifts are moving',
    body: 'Every exercise you have done, in one list, with your best estimated one-rep max and heaviest set. New records and stalled lifts are flagged, so you know what to push and what to change.',
    mock: <ExercisesMock />,
  },
  {
    tone: 'red',
    plate: { thick: 13, wide: 76 },
    title: 'No email. No password. Just a code.',
    body: 'Creating an account gives you a 20-digit code, and that is the whole login. There is nothing to leak and nothing to reset - which also means a lost code is a lost account, so keep it somewhere safe.',
    mock: <CodeMock />,
  },
]

export default function Landing({ onStart }: { onStart: (mode: Mode) => void }) {
  const features = useRef<HTMLDivElement>(null)

  // Each plate goes onto the bar as its card scrolls into view. Once loaded it stays loaded.
  useEffect(() => {
    const items = features.current?.querySelectorAll<HTMLElement>('.lp-feature') ?? []
    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('loaded'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('loaded')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -18% 0px' },
    )
    items.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="landing">
      <header className="lp-top">
        <div className="lp-brand">
          <span className="mark">RT</span>
          RepTracker
        </div>
        <button className="btn ghost" type="button" onClick={() => onStart('login')}>
          Sign in
        </button>
      </header>

      <section className="lp-hero">
        <h1>The logbook for the minute between sets</h1>
        <p className="lp-lede">
          RepTracker logs your sets with one thumb, times your rest, and shows you which lifts are
          moving. No email or password needed.
        </p>
        <div className="lp-actions">
          <button className="btn primary lg" type="button" onClick={() => onStart('register')}>
            Create an account
          </button>
          <button className="btn lg" type="button" onClick={() => onStart('login')}>
            I already have a code
          </button>
        </div>

        <HeroBar />
      </section>

      <div className="lp-features" ref={features}>
        {FEATURES.map((feature, index) => (
          <article
            key={feature.title}
            className={`lp-feature ${index % 2 === 0 ? 'left' : 'right'} tone-${feature.tone}`}
            style={{ '--plate-thick': `${feature.plate.thick}px`, '--plate-wide': `${feature.plate.wide}px` } as CSSProperties}
          >
            <div className="lp-plate" aria-hidden="true" />
            <div className="lp-card">
              <h2>{feature.title}</h2>
              <p>{feature.body}</p>
              <div className="lp-mock">{feature.mock}</div>
            </div>
          </article>
        ))}

        <div className="lp-collar" aria-hidden="true" />
      </div>

      <section className="lp-end">
        <h2>Your first set is waiting</h2>
        <p className="lp-lede">It takes one tap to create an account. Write down the code, then start training.</p>
        <div className="lp-actions">
          <button className="btn primary lg" type="button" onClick={() => onStart('register')}>
            Create an account
          </button>
          <button className="btn lg" type="button" onClick={() => onStart('login')}>
            I already have a code
          </button>
        </div>
      </section>

      <footer className="lp-foot">
        No ads, no trackers, and no requests to anyone else's servers. Weights are stored in
        kilograms and shown in kg or lb.
      </footer>
    </div>
  )
}

/**
 * The page's one unprompted moment: a bar loading itself, heaviest plates first, each one knocking
 * against the last. Drawn edge-on, as you see a bar from the side of the platform.
 */
function HeroBar() {
  // Inner edge of each plate, measured outward from the collar, with its thickness.
  const plates: { tone: Tone; thick: number; tall: number }[] = [
    { tone: 'red', thick: 30, tall: 150 },
    { tone: 'blue', thick: 26, tall: 150 },
    { tone: 'yellow', thick: 22, tall: 150 },
    { tone: 'green', thick: 18, tall: 150 },
    { tone: 'white', thick: 15, tall: 104 },
  ]

  let offset = 0
  const seated = plates.map((plate, index) => {
    const at = offset
    offset += plate.thick + 2
    return { ...plate, at, index }
  })

  const collar = 300 // x of the inner collar on the left; mirrored on the right
  const mid = 90

  return (
    <svg className="lp-bar" viewBox="0 0 1000 180" role="img" aria-label="A barbell loaded with plates">
      <defs>
        <linearGradient id="lp-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--steel-hi)" />
          <stop offset="0.5" stopColor="var(--steel)" />
          <stop offset="1" stopColor="var(--steel-lo)" />
        </linearGradient>
        <pattern id="lp-knurl" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2.4" height="5" fill="var(--steel-lo)" opacity="0.55" />
        </pattern>
      </defs>

      {/* Shaft, with knurling where the hands go. */}
      <rect x={collar} y={mid - 6} width={1000 - 2 * collar} height="12" rx="2" fill="url(#lp-steel)" />
      <rect x="388" y={mid - 6} width="70" height="12" fill="url(#lp-knurl)" />
      <rect x="542" y={mid - 6} width="70" height="12" fill="url(#lp-knurl)" />

      {/* Sleeves and inner collars. */}
      <rect x="40" y={mid - 11} width={collar - 40} height="22" rx="3" fill="url(#lp-steel)" />
      <rect x={1000 - collar} y={mid - 11} width={collar - 40} height="22" rx="3" fill="url(#lp-steel)" />
      <rect x={collar - 4} y={mid - 26} width="12" height="52" rx="2" fill="url(#lp-steel)" />
      <rect x={1000 - collar - 8} y={mid - 26} width="12" height="52" rx="2" fill="url(#lp-steel)" />

      {seated.map((plate) => (
        <g key={plate.index}>
          <rect
            className={`lp-bar-plate from-left tone-${plate.tone}`}
            style={{ '--i': plate.index } as CSSProperties}
            x={collar - 6 - plate.at - plate.thick}
            y={mid - plate.tall / 2}
            width={plate.thick}
            height={plate.tall}
            rx="4"
          />
          <rect
            className={`lp-bar-plate from-right tone-${plate.tone}`}
            style={{ '--i': plate.index } as CSSProperties}
            x={1000 - collar + 6 + plate.at}
            y={mid - plate.tall / 2}
            width={plate.thick}
            height={plate.tall}
            rx="4"
          />
        </g>
      ))}

      {/* Outer clamps go on last. */}
      <rect className="lp-bar-clamp from-left" x={collar - 6 - offset - 14} y={mid - 18} width="14" height="36" rx="3" fill="url(#lp-steel)" />
      <rect className="lp-bar-clamp from-right" x={1000 - collar + 6 + offset} y={mid - 18} width="14" height="36" rx="3" fill="url(#lp-steel)" />
    </svg>
  )
}

// ---- the mock screens: the real app's layout in miniature, using its own colours ----

function LogSetMock() {
  const [weight, setWeight] = useState(120)
  const [reps, setReps] = useState(5)
  const [logged, setLogged] = useState([{ weight: 120, reps: 5 }, { weight: 120, reps: 5 }])

  const done = logged.length >= 5

  return (
    <div className="m-screen">
      <div className="m-head">
        <b>Back Squat</b>
        <span>{done ? 'All 5 sets done' : `Set ${logged.length + 1} of 5`}</span>
      </div>

      <div className="m-stepper">
        <button type="button" aria-label="Less weight" onClick={() => setWeight((w) => Math.max(20, w - 2.5))}>−</button>
        <output>{weight}<small> kg</small></output>
        <button type="button" aria-label="More weight" onClick={() => setWeight((w) => w + 2.5)}>+</button>
      </div>
      <div className="m-stepper">
        <button type="button" aria-label="Fewer reps" onClick={() => setReps((r) => Math.max(1, r - 1))}>−</button>
        <output>{reps}<small> reps</small></output>
        <button type="button" aria-label="More reps" onClick={() => setReps((r) => r + 1)}>+</button>
      </div>

      <button
        type="button"
        className="m-log"
        onClick={() => setLogged((sets) => (done ? [] : [...sets, { weight, reps }]))}
      >
        <CheckIcon />
        {done ? 'Start over' : 'Log set'}
      </button>

      <div className="m-sets" aria-live="polite">
        {logged.map((set, index) => (
          <span key={index} className="m-set">
            <CheckIcon /> {set.weight} × {set.reps}
          </span>
        ))}
      </div>
    </div>
  )
}

function CarryOverMock() {
  const rows = [
    { kg: 60, reps: 8, warmup: true },
    { kg: 80, reps: 8 },
    { kg: 80, reps: 8 },
    { kg: 80, reps: 7 },
  ]

  return (
    <div className="m-screen">
      <div className="m-head">
        <b>Bench Press</b>
        <span>From last Thursday</span>
      </div>
      <table className="m-table">
        <thead>
          <tr><th>Set</th><th>kg</th><th>Reps</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={row.warmup ? 'warm' : undefined}>
              <td>{row.warmup ? 'W' : index}</td>
              <td>{row.kg}</td>
              <td>{row.reps}</td>
              <td><span className="m-box" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const REST_SECONDS = 120

function RestMock() {
  // Counts to an instant, like the real timer, so a throttled background tab cannot drift it.
  const [endsAt, setEndsAt] = useState(() => Date.now() + 107_000)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const left = Math.max(0, Math.ceil((endsAt - now) / 1000))
  const finished = left === 0

  // A few seconds of Go, then the demo rests again.
  useEffect(() => {
    if (!finished) return
    const id = setTimeout(() => setEndsAt(Date.now() + REST_SECONDS * 1000), 4000)
    return () => clearTimeout(id)
  }, [finished])

  const add = (seconds: number) => setEndsAt((end) => Math.max(Date.now(), end + seconds * 1000))

  return (
    <div className="m-screen m-rest">
      <div className={`m-clock${finished ? ' go' : ''}`} aria-live="off">
        {finished ? 'Go' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
      </div>
      <div className="m-track">
        <div style={{ width: `${Math.min(100, (left / REST_SECONDS) * 100)}%` }} />
      </div>
      <div className="m-rest-actions">
        <button type="button" onClick={() => add(-15)}>−15 s</button>
        <button type="button" onClick={() => add(15)}>+15 s</button>
        <button type="button" onClick={() => setEndsAt(Date.now())}>Skip</button>
      </div>
    </div>
  )
}

function StatsMock() {
  // Three weeks of daily volume in tonnes; zeroes are rest days, and stay visible as gaps.
  const days = [0, 9, 0, 14, 0, 7, 0, 0, 10, 0, 15, 0, 8, 0, 0, 11, 0, 16, 0, 9, 0]
  const max = Math.max(...days)

  // `viz` brings in the stats page's own validated chart colours.
  return (
    <div className="m-screen viz">
      <div className="m-head">
        <b>Volume</b>
        <span>Last 3 weeks</span>
      </div>
      <div className="m-bars">
        {days.map((value, index) => (
          <span key={index} style={{ height: `${(value / max) * 100}%` }} />
        ))}
      </div>
      <div className="m-cal" aria-label="Training calendar">
        {days.map((value, index) => (
          <span key={index} className={value > 0 ? 'on' : undefined} />
        ))}
      </div>
    </div>
  )
}

function ExercisesMock() {
  const rows = [
    { name: 'Back Squat', best: '148 kg', status: 'record' as const },
    { name: 'Deadlift', best: '182 kg', status: 'record' as const },
    { name: 'Overhead Press', best: '61 kg', status: 'stalled' as const },
    { name: 'Barbell Row', best: '109 kg', status: null },
  ]

  return (
    <div className="m-screen">
      {rows.map((row) => (
        <div key={row.name} className="m-row">
          <b>{row.name}</b>
          {row.status === 'record' ? (
            <span className="chip success"><TrophyIcon /> New PR</span>
          ) : row.status === 'stalled' ? (
            <span className="chip warn"><AlertIcon /> Stalled</span>
          ) : null}
          <span className="m-best">{row.best}</span>
        </div>
      ))}
    </div>
  )
}

function CodeMock() {
  return (
    <div className="m-screen">
      <div className="m-head">
        <b>This is your only key</b>
      </div>
      <div className="m-code">5108 2273 9046 1835 6627</div>
    </div>
  )
}
