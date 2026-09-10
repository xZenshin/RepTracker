/**
 * `navigator.clipboard` exists only in a secure context, and an app reached over plain http on a
 * LAN address - the normal way a phone hits a dev server, and a real deployment without TLS - is
 * not one. There the property is simply undefined, so the obvious one-liner throws a TypeError and
 * a caller that swallows it is left with a button that looks dead.
 *
 * So: try the async API, fall through to a selected textarea, and report failure honestly. Both
 * paths can still be refused outright (iOS is the usual culprit), which is why this returns a
 * boolean instead of void - the caller owes the user a way to copy by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Unavailable or blocked. The legacy path below may still be permitted.
  }

  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.setAttribute('aria-hidden', 'true')

  // Off-screen rather than hidden: `display: none` or `hidden` cannot hold a selection, and a
  // fixed position keeps focusing it from scrolling the page.
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '0'
  field.style.opacity = '0'
  field.style.pointerEvents = 'none'

  document.body.appendChild(field)

  try {
    field.focus()
    field.select()
    // iOS ignores select() on a textarea; an explicit range is the part it honours.
    field.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
