import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const devPort = Number(process.env.VITE_DEV_PORT || process.env.PORT || 5173)
const previewPort = Number(process.env.VITE_PREVIEW_PORT || 4173)

function pagesBase(): string {
  const raw = (process.env.VITE_BASE_PATH || '').trim()
  if (!raw || raw === '/') return '/'
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`
  return withSlash.startsWith('/') ? withSlash : `/${withSlash}`
}

// https://vite.dev/config/
export default defineConfig({
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
})
