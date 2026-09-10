import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ApiError } from './api/client'
import { signOut } from './api/hooks'
import './styles/theme.css'

/**
 * A 401 from anywhere means the session is gone - signed out in another tab, expired, revoked, or
 * the server restarted under a different login pepper. Without this the app keeps rendering its
 * shell against a dead session and every page just looks empty, which is worse than being told.
 *
 * The /auth/me query never reaches here: it treats 401 as "not signed in" and resolves to null,
 * which is the normal first-visit state rather than an error.
 */
function onUnauthorized(error: unknown) {
  if (error instanceof ApiError && error.status === 401) signOut(queryClient)
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      // Gym wifi drops constantly. Refetching whenever the tab regains focus is what keeps the
      // screen honest after the connection comes back, and one retry covers a brief blip.
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Retrying a 401 just delays the login screen; the session will not come back on its own.
        if (error instanceof ApiError && error.status === 401) return false
        return failureCount < 1
      },
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
