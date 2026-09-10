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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Stop the page behind from scrolling while the sheet is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

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
