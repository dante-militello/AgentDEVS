import type { ClientMessage, ServerMessage } from '@agentdevs/shared'
import { useAppStore } from './store'

type StreamListener = (kind: 'snapshot' | 'output', data: string) => void

const RECONNECT_MS = 1000

/** One shared WebSocket. Terminal output bypasses React state for speed. */
class Socket {
  private ws: WebSocket | null = null
  private readonly listeners = new Map<string, StreamListener>()

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    const store = useAppStore.getState()

    ws.onopen = () => {
      store.setConnected(true)
      for (const terminalId of this.listeners.keys()) this.send({ type: 'attach', terminalId })
    }
    ws.onclose = () => {
      store.setConnected(false)
      setTimeout(() => this.connect(), RECONNECT_MS)
    }
    ws.onmessage = (event) => this.handle(JSON.parse(event.data as string) as ServerMessage)
  }

  private handle(msg: ServerMessage): void {
    const store = useAppStore.getState()
    switch (msg.type) {
      case 'terminals':
        store.setTerminals(msg.terminals)
        break
      case 'terminal':
        store.upsertTerminal(msg.terminal)
        break
      case 'terminal_removed':
        store.removeTerminal(msg.terminalId)
        break
      case 'snapshot':
      case 'output':
        this.listeners.get(msg.terminalId)?.(msg.type, msg.data)
        break
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  attach(terminalId: string, listener: StreamListener): () => void {
    this.listeners.set(terminalId, listener)
    this.send({ type: 'attach', terminalId })
    return () => {
      this.listeners.delete(terminalId)
      this.send({ type: 'detach', terminalId })
    }
  }
}

export const socket = new Socket()
