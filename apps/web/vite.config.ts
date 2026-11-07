import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SERVER = 'http://localhost:4317'

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true, changeOrigin: false },
    },
  },
})
