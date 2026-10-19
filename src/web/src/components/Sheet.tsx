import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './sheet.css'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/**
 * A bottom sheet on a phone and a centred dialog on a wide screen. Sheets are used rather than
 * routes for pickers so that the workout underneath is never torn down mid-set.
 */
export default function Sheet({ title, onClose, children, footer }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Callers pass onClose inline, so it is a new function on every render of the page behind -
  // four times a second while the rest timer runs. Read through a ref, so the effect below runs
  // once per opening rather than on every one of those renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Once per opening, not per render: this moves focus to the panel, and re-running it pulled the
  // cursor out of whichever field inside the sheet was being typed in.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)

    // Stop the page behind from scrolling while the sheet is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Unless a field inside already took focus with autoFocus, which runs before this effect.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [])

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1}>
        <header className="sheet-header">
          <span className="grabber" aria-hidden />
          <h2>{title}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose}>Close</button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
