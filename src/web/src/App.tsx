import { Suspense, lazy, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useMatch, useNavigate } from 'react-router-dom'
import { useMe } from './api/hooks'
import { useLiveWorkout } from './lib/liveWorkout'
import { ChartIcon, DumbbellIcon, HistoryIcon, SettingsIcon } from './components/Icons'
import { useIsDesktop } from './lib/useMediaQuery'
import Login, { CodeIssued, type Mode } from './pages/Login'
import Train from './pages/Train'
import ActiveWorkout from './pages/ActiveWorkout'
import History from './pages/History'
import WorkoutDetail from './pages/WorkoutDetail'
import RoutineEditor from './pages/RoutineEditor'
import Settings from './pages/Settings'

// The charting library is a third of the bundle and only the stats pages use it. Splitting it out
// keeps the screen you open in the gym small, which is the one loading on bad signal.
const Dashboard = lazy(() => import('./pages/Dashboard'))
// Only signed-out visitors see the landing page, so signed-in users never download it.
const Landing = lazy(() => import('./pages/Landing'))
const ExerciseList = lazy(() => import('./pages/ExerciseList'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))

export default function App() {
  const { data: user, isPending } = useMe()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const inWorkout = useMatch('/workout') !== null

  // Registering signs you in as a side effect, so `user` is already set by the time the code
  // screen would render. It therefore has to live above this gate rather than inside Login -
  // otherwise the write to the `me` cache unmounts Login mid-flow and the one copy of the code
  // the user will ever be shown is destroyed before it paints.
  const [issuedCode, setIssuedCode] = useState<string | null>(null)

  // Signed out, the landing page comes first; its buttons open the sign-in card in either mode.
  const [auth, setAuth] = useState<Mode | null>(null)

  if (isPending) return <BootSplash />

  if (issuedCode) {
    return (
      <CodeIssued
        code={issuedCode}
        onDone={() => {
          setIssuedCode(null)
          navigate('/', { replace: true })
        }}
      />
    )
  }

  if (!user) {
    if (auth) {
      return <Login key={auth} initialMode={auth} onIssued={setIssuedCode} onBack={() => setAuth(null)} />
    }
    return (
      <Suspense fallback={<BootSplash />}>
        <Landing onStart={setAuth} />
      </Suspense>
    )
  }

  // Forget which form was used, so signing out lands on the landing page rather than back on it.
  if (auth) setAuth(null)

  return (
    <div className={`app${inWorkout ? ' focus-mode' : ''}`}>
      <Nav />
      <Routes>
        <Route path="/" element={<Train />} />
        <Route path="/workout" element={<ActiveWorkout />} />
        <Route path="/routines/new" element={<RoutineEditor />} />
        <Route path="/routines/:id" element={<RoutineEditor />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:id" element={<WorkoutDetail />} />
        {/* Stats are desktop-only: on a phone the app is for logging the workout in front of you.
            The guard sits above Lazy so a phone never downloads the charting chunk at all. */}
        <Route path="/stats" element={isDesktop ? <Lazy><Dashboard /></Lazy> : <Navigate to="/" replace />} />
        <Route
          path="/stats/exercises"
          element={isDesktop ? <Lazy><ExerciseList /></Lazy> : <Navigate to="/" replace />}
        />
        <Route
          path="/stats/exercises/:exerciseId"
          element={isDesktop ? <Lazy><ExerciseDetail /></Lazy> : <Navigate to="/" replace />}
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="page">
          <div className="skeleton" style={{ height: 96, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 300 }} />
        </main>
      }
    >
      {children}
    </Suspense>
  )
}

function Nav() {
  const active = useLiveWorkout()
  const isDesktop = useIsDesktop()

  return (
    <nav className="nav">
      <div className="brand">
        <span className="mark">RT</span>
        RepTracker
      </div>

      <NavLink to="/" end>
        <DumbbellIcon />
        Train
        {active ? <span className="live-dot" aria-label="Workout in progress" /> : null}
      </NavLink>
      <NavLink to="/history">
        <HistoryIcon />
        History
      </NavLink>
      {isDesktop ? (
        <NavLink to="/stats">
          <ChartIcon />
          Stats
        </NavLink>
      ) : null}
      <NavLink to="/settings">
        <SettingsIcon />
        Settings
      </NavLink>
    </nav>
  )
}

function BootSplash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-faint)' }}>
      <div className="skeleton" style={{ width: 120, height: 12 }} />
    </div>
  )
}
