export class ApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }

  /** True when the server refused because the caller is going too fast, not because of the input. */
  get isRateLimited() {
    return this.status === 429
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

/**
 * Thin wrapper over fetch. Everything is same-origin, so the session cookie rides along without
 * any token handling in the client and there is nothing auth-related in localStorage to steal.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
    signal: options.signal,
  })

  if (!response.ok) throw await toError(response)

  if (response.status === 204) return undefined as T

  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function toError(response: Response): Promise<ApiError> {
  const retryAfter = Number(response.headers.get('Retry-After')) || undefined

  if (response.status === 429) {
    return new ApiError(
      429,
      retryAfter
        ? `Too many attempts. Try again in ${formatWait(retryAfter)}.`
        : 'Too many attempts. Try again shortly.',
      retryAfter,
    )
  }

  // The API answers failures with RFC 7807 problem details; fall back to the status text when a
  // proxy or the platform itself produced the response instead.
  let detail = response.statusText || 'Something went wrong.'
  try {
    const body = await response.json()
    if (typeof body?.detail === 'string') detail = body.detail
    else if (typeof body?.title === 'string') detail = body.title
  } catch {
    // Not JSON. The status text will do.
  }

  return new ApiError(response.status, detail)
}

function formatWait(seconds: number) {
  if (seconds < 90) return `${seconds} seconds`
  return `${Math.ceil(seconds / 60)} minutes`
}

/** The browser's offset from UTC in minutes, so the server buckets days and weeks by local time. */
export function utcOffsetMinutes() {
  return -new Date().getTimezoneOffset()
}
