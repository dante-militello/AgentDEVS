import type { CreateTerminalInput, TerminalDTO, TerminalRole, TerminalStatus } from '@agentdevs/shared'
import { buildClaudeArgs, sessionTranscriptPath, type LaunchMode } from './claudeCommand.js'
import type { ParsedHook } from './hooks.js'
import type { PtyHost, PtyHostEvents, StreamSink } from './ptyHost.js'
import type { TerminalRecord, TerminalRepo } from './terminalRepo.js'
import { nextStatus, type TerminalEvent } from './terminalState.js'

const SUMMARY_MAX_CHARS = 280
/** Typing then Enter in one chunk can be read as a paste (Enter becomes a newline): split them. */
const SUBMIT_ENTER_DELAY_MS = 150
const SUBMIT_DELAY_PER_CHAR_MS = 0.5
const SUBMIT_MAX_DELAY_MS = 1200
/** Typing from the web within this window means the user is composing: automation must wait. */
const USER_ACTIVE_WINDOW_MS = 10_000

export interface LaunchExtras {
  env?: Record<string, string>
  settingsPath?: string
  /** Role-specific CLI flags, applied on every launch (new and resume). */
  extraArgs?: string[]
}

/** Internal creation input: the public API only exposes title/cwd; roles come from the PM tools. */
export interface CreateOptions extends CreateTerminalInput {
  role?: TerminalRole
  parentId?: string | null
  repoPath?: string | null
  branch?: string | null
  /** First message for the new Claude session (the worker brief). */
  initialPrompt?: string
}

export interface SessionServiceDeps {
  repo: TerminalRepo
  createHost: (events: PtyHostEvents) => PtyHost
  claudeBin: string
  claudeHome: string
  isDirectory: (path: string) => boolean
  fileExists: (path: string) => boolean
  onTerminalChanged: (terminal: TerminalDTO) => void
  /** Fired only when the status actually changes (drives notifications). */
  onTransition?: (previous: TerminalStatus, terminal: TerminalDTO) => void
  /** Per-terminal env + settings file (hook wiring). */
  launchExtras?: (record: TerminalRecord) => LaunchExtras
  readSummary?: (transcriptPath: string, maxChars: number) => Promise<string | null>
  logError?: (message: string, error: unknown) => void
  /** Raw pty output tap. */
  onOutput?: (terminalId: string, data: string) => void
  /** Called right after a Claude process is spawned (new or resumed). */
  onLaunched?: (record: TerminalRecord) => void
}

export interface SessionService {
  list(): TerminalDTO[]
  get(id: string): TerminalDTO | null
  create(input: CreateOptions): TerminalDTO
  /** Adopts an existing Claude session (found on disk) and resumes it. */
  importSession(input: { sessionId: string; cwd: string; title: string }): TerminalDTO
  relaunch(id: string): TerminalDTO
  remove(id: string): void
  restoreAll(): void
  applyEvent(id: string, event: TerminalEvent, summary?: string | null): TerminalDTO | null
  handleHook(id: string, hook: ParsedHook): Promise<TerminalDTO | null>
  write(id: string, data: string): void
  /** Types text into the Claude prompt and presses Enter (as if the user did it). */
  submit(id: string, text: string): void
  /** Records that the user typed into this terminal from the web. */
  noteUserInput(id: string): void
  isUserActive(id: string): boolean
  resize(id: string, cols: number, rows: number): void
  subscribe(id: string, sink: StreamSink): () => void
  shutdown(): void
}

export class SessionError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { repo } = deps
  const logError = deps.logError ?? (() => {})
  let isShuttingDown = false
  const lastUserInputAt = new Map<string, number>()

  const host = deps.createHost({
    onData: deps.onOutput,
    onExit: (id) => {
      // A server shutdown is not the user closing the terminal: keep it restorable.
      if (isShuttingDown) return
      applyEvent(id, { kind: 'exited' })
    },
  })

  const toDTO = (record: TerminalRecord): TerminalDTO => ({ ...record, isAlive: host.isAlive(record.id) })

  function applyEvent(id: string, event: TerminalEvent, summary?: string | null): TerminalDTO | null {
    const current = repo.findById(id)
    if (!current) return null
    const status = nextStatus(current.status, event)
    // Keystrokes on a terminal that is not waiting for anything change nothing: skip the write.
    if (event.kind === 'user_input' && status === current.status) return toDTO(current)
    const updated = repo.update(id, {
      status,
      lastActivityAt: Date.now(),
      ...(summary !== undefined ? { lastSummary: summary } : {}),
    })
    if (!updated) return null
    const dto = toDTO(updated)
    deps.onTerminalChanged(dto)
    if (current.status !== status) deps.onTransition?.(current.status, dto)
    return dto
  }

  const launch = (record: TerminalRecord, mode: LaunchMode, initialPrompt?: string): TerminalDTO => {
    const extras = deps.launchExtras?.(record) ?? {}
    host.spawn({
      id: record.id,
      file: deps.claudeBin,
      args: buildClaudeArgs({
        sessionId: record.sessionId,
        mode,
        settingsPath: extras.settingsPath,
        extraArgs: extras.extraArgs,
        initialPrompt,
      }),
      cwd: record.cwd,
      env: extras.env,
    })
    deps.onLaunched?.(record)
    const dto = applyEvent(record.id, { kind: 'spawned' })
    if (!dto) throw new SessionError(`Terminal ${record.id} vanished during launch`)
    return dto
  }

  const modeFor = (record: TerminalRecord): LaunchMode =>
    deps.fileExists(sessionTranscriptPath(deps.claudeHome, record.cwd, record.sessionId)) ? 'resume' : 'new'

  const requireRecord = (id: string): TerminalRecord => {
    const record = repo.findById(id)
    if (!record) throw new SessionError('La terminal no existe')
    return record
  }

  const markFailed = (record: TerminalRecord, reason: string): void => {
    applyEvent(record.id, { kind: 'exited' }, reason)
  }

  return {
    list: () => repo.findAll().map(toDTO),
    get: (id) => {
      const record = repo.findById(id)
      return record ? toDTO(record) : null
    },
    create(input) {
      if (!deps.isDirectory(input.cwd)) throw new SessionError(`La carpeta no existe: ${input.cwd}`)
      const record = repo.create({
        title: input.title,
        cwd: input.cwd,
        missionId: input.missionId ?? null,
        role: input.role,
        parentId: input.parentId,
        repoPath: input.repoPath,
        branch: input.branch,
      })
      try {
        return launch(record, 'new', input.initialPrompt)
      } catch (error: unknown) {
        repo.archive(record.id)
        logError(`Failed to launch terminal ${record.id}`, error)
        throw new SessionError(`No se pudo abrir Claude: ${errorMessage(error)}`)
      }
    },
    importSession({ sessionId, cwd, title }) {
      if (repo.allSessionIds().has(sessionId)) throw new SessionError(`La sesión "${title}" ya está en AgentDEVS`)
      if (!deps.isDirectory(cwd)) throw new SessionError(`La carpeta no existe: ${cwd}`)
      if (!deps.fileExists(sessionTranscriptPath(deps.claudeHome, cwd, sessionId))) {
        throw new SessionError(`No encontré el historial de "${title}"`)
      }
      const record = repo.create({ title, cwd, missionId: null, sessionId })
      try {
        return launch(record, 'resume')
      } catch (error: unknown) {
        repo.archive(record.id)
        logError(`Failed to import session ${sessionId}`, error)
        throw new SessionError(`No se pudo retomar "${title}": ${errorMessage(error)}`)
      }
    },
    relaunch(id) {
      const record = requireRecord(id)
      if (host.isAlive(id)) return toDTO(record)
      try {
        return launch(record, modeFor(record))
      } catch (error: unknown) {
        logError(`Failed to relaunch terminal ${id}`, error)
        throw new SessionError(`No se pudo reabrir Claude: ${errorMessage(error)}`)
      }
    },
    remove(id) {
      requireRecord(id)
      repo.archive(id)
      host.kill(id)
    },
    restoreAll() {
      for (const record of repo.findRestorable()) {
        if (record.status === 'exited' || host.isAlive(record.id)) continue
        if (!deps.isDirectory(record.cwd)) {
          markFailed(record, `No se pudo restaurar: falta la carpeta ${record.cwd}`)
          continue
        }
        try {
          launch(record, modeFor(record))
        } catch (error: unknown) {
          logError(`Failed to restore terminal ${record.id}`, error)
          markFailed(record, `No se pudo restaurar: ${errorMessage(error)}`)
        }
      }
    },
    applyEvent,
    async handleHook(id, hook) {
      if (hook.event !== 'Stop') {
        return applyEvent(id, { kind: 'hook', event: hook.event }, hook.message ?? undefined)
      }
      let summary: string | null | undefined
      if (hook.transcriptPath && deps.readSummary) {
        try {
          summary = await deps.readSummary(hook.transcriptPath, SUMMARY_MAX_CHARS)
        } catch (error: unknown) {
          logError(`Failed to read transcript for ${id}`, error)
        }
      }
      return applyEvent(id, { kind: 'hook', event: 'Stop' }, summary ?? undefined)
    },
    write: (id, data) => host.write(id, data),
    submit(id, text) {
      host.write(id, text)
      // Long text arrives as a paste; give the TUI time to absorb it before Enter.
      const delay = Math.min(SUBMIT_ENTER_DELAY_MS + text.length * SUBMIT_DELAY_PER_CHAR_MS, SUBMIT_MAX_DELAY_MS)
      setTimeout(() => host.write(id, '\r'), delay)
    },
    noteUserInput(id) {
      lastUserInputAt.set(id, Date.now())
    },
    isUserActive(id) {
      return Date.now() - (lastUserInputAt.get(id) ?? 0) < USER_ACTIVE_WINDOW_MS
    },
    resize: (id, cols, rows) => host.resize(id, cols, rows),
    subscribe: (id, sink) => host.subscribe(id, sink),
    shutdown: () => {
      isShuttingDown = true
      host.killAll()
    },
  }
}
