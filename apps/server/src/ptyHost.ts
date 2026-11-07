import { createRequire } from 'node:module'
import type { IPty } from '@lydell/node-pty'
import { buildChildEnv } from './childEnv.js'
import { trackPrivateModes, type ModeTracker } from './terminalModes.js'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { SerializeAddon as SerializeAddonType } from '@xterm/addon-serialize'

const require = createRequire(import.meta.url)
const pty = require('@lydell/node-pty') as typeof import('@lydell/node-pty')
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless')
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')

const SCROLLBACK_LINES = 5000
const OUTPUT_FLUSH_MS = 8
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

export interface SpawnOptions {
  id: string
  file: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface PtyHostEvents {
  onExit: (id: string, exitCode: number) => void
  /** Raw output tap (e.g. to detect dialogs). Must be cheap: runs on every chunk. */
  onData?: (id: string, data: string) => void
}

/** A viewer of one terminal: gets one snapshot, then only the output produced after it. */
export interface StreamSink {
  snapshot: (data: string) => void
  output: (data: string) => void
}

interface Subscriber {
  sink: StreamSink
  isReady: boolean
  backlog: string
}

interface Session {
  proc: IPty
  mirror: HeadlessTerminal
  serializer: SerializeAddonType
  modes: ModeTracker
  pending: string
  flushTimer: NodeJS.Timeout | null
  subscribers: Set<Subscriber>
}

export interface PtyHost {
  spawn(options: SpawnOptions): void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  isAlive(id: string): boolean
  subscribe(id: string, sink: StreamSink): () => void
  killAll(): void
}

/** node-pty throws if the child died but onExit has not run yet; that must never crash the server. */
function safely(action: () => void): void {
  try {
    action()
  } catch {
    // Process already gone: onExit will reconcile state.
  }
}

export function createPtyHost(events: PtyHostEvents): PtyHost {
  const sessions = new Map<string, Session>()

  const flush = (session: Session): void => {
    if (session.flushTimer) clearTimeout(session.flushTimer)
    session.flushTimer = null
    if (!session.pending) return
    const chunk = session.pending
    session.pending = ''
    for (const sub of session.subscribers) {
      if (sub.isReady) sub.sink.output(chunk)
      else sub.backlog += chunk
    }
  }

  return {
    spawn({ id, file, args, cwd, env }) {
      if (sessions.has(id)) throw new Error(`Terminal ${id} is already running`)
      const proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd,
        env: buildChildEnv(process.env, env ?? {}),
      })
      const mirror = new Terminal({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, scrollback: SCROLLBACK_LINES, allowProposedApi: true })
      const serializer = new SerializeAddon()
      mirror.loadAddon(serializer)
      const modes = trackPrivateModes(mirror)
      const session: Session = { proc, mirror, serializer, modes, pending: '', flushTimer: null, subscribers: new Set() }
      sessions.set(id, session)

      proc.onData((data) => {
        mirror.write(data)
        events.onData?.(id, data)
        session.pending += data
        session.flushTimer ??= setTimeout(() => flush(session), OUTPUT_FLUSH_MS)
      })
      proc.onExit(({ exitCode }) => {
        flush(session)
        session.subscribers.clear()
        mirror.dispose()
        sessions.delete(id)
        events.onExit(id, exitCode)
      })
    },
    write(id, data) {
      const session = sessions.get(id)
      if (session) safely(() => session.proc.write(data))
    },
    resize(id, cols, rows) {
      const session = sessions.get(id)
      if (!session) return
      safely(() => session.proc.resize(cols, rows))
      safely(() => session.mirror.resize(cols, rows))
    },
    kill(id) {
      const session = sessions.get(id)
      if (session) safely(() => session.proc.kill())
    },
    isAlive(id) {
      return sessions.has(id)
    },
    subscribe(id, sink) {
      const session = sessions.get(id)
      if (!session) {
        sink.snapshot('')
        return () => {}
      }
      // Everything received so far goes to existing viewers; the empty write is a marker in the
      // mirror's parse queue, so the snapshot covers exactly the bytes before it and the backlog
      // holds exactly the bytes after it. No gaps, no duplicates.
      flush(session)
      const sub: Subscriber = { sink, isReady: false, backlog: '' }
      session.subscribers.add(sub)
      session.mirror.write('', () => {
        if (!session.subscribers.has(sub)) return
        sink.snapshot(session.serializer.serialize() + session.modes.toSequence())
        sub.isReady = true
        if (sub.backlog) sink.output(sub.backlog)
        sub.backlog = ''
      })
      return () => {
        session.subscribers.delete(sub)
      }
    },
    killAll() {
      for (const session of sessions.values()) safely(() => session.proc.kill())
    },
  }
}
