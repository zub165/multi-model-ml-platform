import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const devPort = Number(process.env.VITE_DEV_PORT || process.env.PORT || 5173)
const previewPort = Number(process.env.VITE_PREVIEW_PORT || 4173)

// https://vite.dev/config/
export default defineConfig({
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
