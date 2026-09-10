import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'rt.rest-until'

interface RestTimer {
  /** Seconds left, or null when no rest is running. */
  remaining: number | null
  /** What the timer was started with, for drawing progress. */
  total: number | null
  start: (seconds: number) => void
  stop: () => void
  add: (seconds: number) => void
}

/**
 * Counts down to a wall-clock instant rather than by decrementing a tick.
 *
 * That matters here: phones throttle timers in backgrounded tabs, and the screen will be off or
 * the app switched away for most of a three-minute rest. Storing the end time means the countdown
 * is still correct when you look back at it, and survives a reload.
 */
export function useRestTimer(): RestTimer {
  const [endsAt, setEndsAt] = useState<number | null>(() => readStored())
  const [total, setTotal] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const firedRef = useRef(false)

  useEffect(() => {
    if (endsAt === null) return

    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, 250)

    // A backgrounded tab stops ticking, so resync the moment it becomes visible again.
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [endsAt])

  const remaining = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000))

  useEffect(() => {
    if (remaining === null || remaining > 0) return
    if (firedRef.current) return

    firedRef.current = true
    alertRestOver()

    // Leave the finished timer on screen briefly so it registers, then clear it.
    const id = window.setTimeout(() => {
      setEndsAt(null)
      setTotal(null)
      sessionStorage.removeItem(STORAGE_KEY)
    }, 4000)

    return () => window.clearTimeout(id)
  }, [remaining])

  const start = useCallback((seconds: number) => {
    if (seconds <= 0) return
    firedRef.current = false
    const target = Date.now() + seconds * 1000
    setEndsAt(target)
    setTotal(seconds)
    setNow(Date.now())
    try {
      sessionStorage.setItem(STORAGE_KEY, String(target))
    } catch {
      // Private mode can refuse storage; the timer still runs for this page view.
    }
  }, [])

  const stop = useCallback(() => {
    firedRef.current = true
    setEndsAt(null)
    setTotal(null)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nothing to clean up if storage was never available.
    }
  }, [])

  const add = useCallback((seconds: number) => {
    firedRef.current = false
    setEndsAt((current) => {
      const target = Math.max(Date.now(), current ?? Date.now()) + seconds * 1000
      try {
        sessionStorage.setItem(STORAGE_KEY, String(target))
      } catch {
        // As above.
      }
      return target
    })
    setTotal((current) => (current ?? 0) + seconds)
  }, [])

  return { remaining, total, start, stop, add }
}

function readStored(): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > Date.now() ? value : null
  } catch {
    return null
  }
}

/**
 * Two short tones and a buzz. Headphones are usually in, so sound carries better than anything
 * visual, and the vibration covers the case where they are not.
 */
function alertRestOver() {
  try {
    navigator.vibrate?.([180, 90, 180])
  } catch {
    // Unsupported on desktop; the tone still plays.
  }

  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    const context = new AudioContextClass()
    const play = (at: number) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      // A short envelope rather than a hard stop, which would click.
      gain.gain.setValueAtTime(0.0001, context.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.35, context.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + at + 0.22)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(context.currentTime + at)
      oscillator.stop(context.currentTime + at + 0.24)
    }

    play(0)
    play(0.3)
    setTimeout(() => void context.close(), 1200)
  } catch {
    // Audio can be blocked until the page has been interacted with. The vibration stands in.
  }
}
