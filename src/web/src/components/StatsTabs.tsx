import { NavLink } from 'react-router-dom'
import './stats-tabs.css'

/** The two halves of the stats section: the period overview and the list of every exercise. */
export default function StatsTabs() {
  return (
    <nav className="stats-tabs" aria-label="Stats sections">
      <NavLink to="/stats" end>Overview</NavLink>
      <NavLink to="/stats/exercises">Exercises</NavLink>
    </nav>
  )
}
