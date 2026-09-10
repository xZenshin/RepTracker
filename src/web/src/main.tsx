import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/theme.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Gym wifi drops constantly. Refetching whenever the tab regains focus is what keeps the
      // screen honest after the connection comes back, and one retry covers a brief blip.
      refetchOnWindowFocus: true,
      retry: 1,
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
