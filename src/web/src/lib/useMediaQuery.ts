import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a media query currently matches. Read synchronously on the first render rather than set
 * from an effect, so a phone never paints desktop-only UI for a frame - or starts loading a chunk
 * for a route it is about to be redirected away from.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

// Same width as the nav's sidebar breakpoint in styles/theme.css - keep the two in step.
export const useIsDesktop = () => useMediaQuery('(min-width: 900px)')
