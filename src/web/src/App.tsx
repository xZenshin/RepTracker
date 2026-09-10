import { Suspense, lazy, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useActiveWorkout, useMe } from './api/hooks'
import { ChartIcon, DumbbellIcon, HistoryIcon, SettingsIcon } from './components/Icons'
import Login from './pages/Login'
import Train from './pages/Train'
import ActiveWorkout from './pages/ActiveWorkout'
import History from './pages/History'
import WorkoutDetail from './pages/WorkoutDetail'
import RoutineEditor from './pages/RoutineEditor'
import Settings from './pages/Settings'

// The charting library is a third of the bundle and only the stats pages use it. Splitting it out
// keeps the screen you open in the gym small, which is the one loading on bad signal.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))

export default function App() {
  const { data: user, isPending } = useMe()

  if (isPending) return <BootSplash />
  if (!user) return <Login />

  return (
    <div className="app">
      <Nav />
      <Routes>
        <Route path="/" element={<Train />} />
        <Route path="/workout" element={<ActiveWorkout />} />
        <Route path="/routines/new" element={<RoutineEditor />} />
        <Route path="/routines/:id" element={<RoutineEditor />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:id" element={<WorkoutDetail />} />
        <Route path="/stats" element={<Lazy><Dashboard /></Lazy>} />
        <Route path="/stats/:exerciseId" element={<Lazy><ExerciseDetail /></Lazy>} />
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
  const { data: active } = useActiveWorkout()

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
      <NavLink to="/stats">
        <ChartIcon />
        Stats
      </NavLink>
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
