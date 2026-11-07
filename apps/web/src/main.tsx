import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import { App } from './App'
import { socket } from './socket'
import './styles.css'

async function boot(): Promise<void> {
  await api.ensureSession()
  socket.connect()
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root element')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot().catch((error: unknown) => {
  document.body.textContent = `No se pudo conectar con AgentDEVS: ${error instanceof Error ? error.message : String(error)}`
})
