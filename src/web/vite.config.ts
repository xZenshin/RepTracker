import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA is served by the API in production, so the build lands directly in its wwwroot and
// there is only ever one origin - no CORS, and cookies are plain same-site.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../RepTracker.Api/wwwroot',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5199',
    },
  },
})
