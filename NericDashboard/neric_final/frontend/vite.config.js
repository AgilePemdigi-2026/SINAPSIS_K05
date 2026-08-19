import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BRAIN_BACKEND = 'http://localhost:8000'
const CV_BACKEND    = 'http://localhost:8001'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: BRAIN_BACKEND,
        changeOrigin: true,
        secure: false,
      },
      '/cv': {
        target: CV_BACKEND,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cv/, '/api/cv'),
        secure: false,
      },
    },
  },
})
