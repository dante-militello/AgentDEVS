import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { TerminalDTO, TerminalStatus } from '@agentdevs/shared'

const require = createRequire(import.meta.url)
const ATTENTION_STATUSES: readonly TerminalStatus[] = ['done', 'needs_input']
const APP_ID = 'AgentDEVS'

export function shouldNotify(previous: TerminalStatus, next: TerminalStatus): boolean {
  return previous !== next && ATTENTION_STATUSES.includes(next)
}

export interface Notifier {
  notifyTransition(previous: TerminalStatus, terminal: TerminalDTO): void
}

function toastText(terminal: TerminalDTO): { title: string; message: string } {
  if (terminal.status === 'needs_input') {
    return { title: `🟡 ${terminal.title} te necesita`, message: terminal.lastSummary ?? 'Está esperando tu respuesta' }
  }
  return { title: `✅ ${terminal.title} terminó`, message: terminal.lastSummary ?? 'Terminó de responder' }
}

/** Opens the URL with the default browser without going through a shell string. */
function openUrl(url: string): void {
  const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

export function createWindowsNotifier(baseUrl: string, logError: (msg: string, err: unknown) => void): Notifier {
  const notifier = require('node-notifier') as typeof import('node-notifier')
  return {
    notifyTransition(previous, terminal) {
      if (!shouldNotify(previous, terminal.status)) return
      const { title, message } = toastText(terminal)
      const url = `${baseUrl}/#t=${terminal.id}`
      try {
        notifier.notify({ title, message, appID: APP_ID, wait: true, sound: true } as never, (error, response) => {
          if (error) logError('Toast failed', error)
          // SnoreToast reports a body click as "activate".
          if (String(response).toLowerCase().includes('activate')) openUrl(url)
        })
      } catch (error: unknown) {
        logError('Toast failed', error)
      }
    },
  }
}
