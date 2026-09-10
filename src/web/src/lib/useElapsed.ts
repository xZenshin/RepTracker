import { useEffect, useState } from 'react'

/**
 * Seconds since a timestamp, recomputed from the clock rather than accumulated, so the workout
 * clock is still right after the phone has been asleep in a pocket for twenty minutes.
 */
export function useElapsed(since: string | null | undefined): number | null {
  const [seconds, setSeconds] = useState(() => compute(since))

  useEffect(() => {
    if (!since) return

    const update = () => setSeconds(compute(since))
    update()

    const id = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', update)
    }
  }, [since])

  return seconds
}

function compute(since: string | null | undefined): number | null {
  if (!since) return null
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000))
}
