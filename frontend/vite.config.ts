import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function pagesBase(): string {
  const raw = (process.env.VITE_BASE_PATH || '').trim()
  if (!raw || raw === '/') return '/'
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`
  return withSlash.startsWith('/') ? withSlash : `/${withSlash}`
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devPort = Number(env.VITE_DEV_PORT || process.env.PORT || 5173)
  const previewPort = Number(env.VITE_PREVIEW_PORT || 4173)

  return {
    base: pagesBase(),
    plugins: [react()],
    server: {
      port: devPort,
      strictPort: true,
    },
    preview: {
      port: previewPort,
      strictPort: true,
      host: true,
    },
  }
})
