import { readFile } from 'node:fs/promises'
import type { TerminalRole } from '@agentdevs/shared'

/**
 * Claude's first-run folder dialog, matched without spaces (the TUI positions words with cursor moves).
 * All parts must be on screen, so a worker merely printing one phrase can never trigger keystrokes.
 */
const TRUST_DIALOG_PARTS = ['No,exit', 'Itrustthisfolder', 'Entertoconfirm']
const WATCH_WINDOW_MS = 30_000
const BUFFER_CHARS = 8000
const KEY_DELAY_MS = 120
const ARROW_DOWN = '\x1b[B'

type Projects = Record<string, { hasTrustDialogAccepted?: boolean } | undefined>

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

/** True if the path, or a folder containing it, was trusted by the user in Claude Code. */
export function isPathTrusted(projects: Projects, path: string): boolean {
  const target = normalize(path)
  return Object.entries(projects).some(([key, value]) => {
    if (!value?.hasTrustDialogAccepted) return false
    const trusted = normalize(key)
    return target === trusted || target.startsWith(`${trusted}/`)
  })
}

/** Reads Claude's trust list (read-only: Claude rewrites this file often, we never touch it). */
export async function readTrustedProjects(claudeJsonPath: string): Promise<Projects> {
  try {
    const parsed = JSON.parse(await readFile(claudeJsonPath, 'utf8')) as { projects?: Projects }
    return parsed.projects ?? {}
  } catch {
    return {}
  }
}

export function screenText(data: string): string {
  return data
    .replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\s+/g, '')
}

export interface TrustGateDeps {
  getTerminal: (id: string) => { role: TerminalRole; repoPath: string | null; cwd: string } | null
  isRepoTrusted: (repoPath: string) => boolean | Promise<boolean>
  write: (id: string, data: string) => void
  needsUser: (id: string, reason: string) => void
}

export interface TrustGate {
  /** Start watching a freshly launched worker or PM for the folder-trust dialog. */
  watch(id: string): void
  onOutput(id: string, data: string): void
}

/**
 * Workers run in brand-new worktree folders, which Claude asks to trust even when the repo is
 * already trusted. If the user trusted the repo, answer "Yes" for them; otherwise ask the user.
 */
export function createTrustGate(deps: TrustGateDeps): TrustGate {
  const watched = new Map<string, { buffer: string; timer: NodeJS.Timeout }>()

  const stop = (id: string): void => {
    const entry = watched.get(id)
    if (entry) clearTimeout(entry.timer)
    watched.delete(id)
  }

  return {
    watch(id) {
      stop(id)
      watched.set(id, { buffer: '', timer: setTimeout(() => stop(id), WATCH_WINDOW_MS) })
    },
    onOutput(id, data) {
      const entry = watched.get(id)
      if (!entry) return
      entry.buffer = (entry.buffer + screenText(data)).slice(-BUFFER_CHARS)
      if (!TRUST_DIALOG_PARTS.every((part) => entry.buffer.includes(part))) return
      stop(id)
      const terminal = deps.getTerminal(id)
      // Workers are judged by their repo (the worktree is new); the PM by its own folder.
      const repoPath = terminal?.role === 'worker' ? terminal.repoPath : terminal?.role === 'pm' ? terminal.cwd : null
      void Promise.resolve(repoPath ? deps.isRepoTrusted(repoPath) : false)
        .catch(() => false)
        .then((isTrusted) => {
          if (!isTrusted) {
            deps.needsUser(id, 'Claude pide confirmar la confianza en esta carpeta nueva. Entrá y elegí "Yes, I trust this folder".')
            return
          }
          setTimeout(() => deps.write(id, ARROW_DOWN), KEY_DELAY_MS)
          setTimeout(() => deps.write(id, '\r'), KEY_DELAY_MS * 2)
        })
    },
  }
}
