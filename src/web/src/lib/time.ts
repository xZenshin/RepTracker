/** Formats a span for the workout clock: 1:04:22 once it passes an hour, 4:22 before that. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '-'
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Compact hours for summary tiles, where seconds are noise. */
export function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600
  if (hours < 1) return `${Math.round(totalSeconds / 60)} min`
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** "3 days ago" reads better than a date when the point is how long it has been. */
export function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
