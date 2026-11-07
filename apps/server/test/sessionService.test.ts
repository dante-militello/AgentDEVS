import { beforeEach, describe, expect, test } from 'vitest'
import type { TerminalDTO, TerminalStatus } from '@agentdevs/shared'
import { openDatabase } from '../src/db.js'
import { createTerminalRepo, type TerminalRepo } from '../src/terminalRepo.js'
import { createSessionService, type SessionService, type SessionServiceDeps } from '../src/sessionService.js'
import type { PtyHost, PtyHostEvents, SpawnOptions } from '../src/ptyHost.js'

function fakePtyHost() {
  const spawned: SpawnOptions[] = []
  const alive = new Set<string>()
  let events: PtyHostEvents | null = null
  let failNextSpawn = false
  const host: PtyHost = {
    spawn: (o) => {
      if (failNextSpawn) {
        failNextSpawn = false
        throw new Error('spawn ENOENT')
      }
      spawned.push(o)
      alive.add(o.id)
    },
    write: () => {},
    resize: () => {},
    kill: (id) => {
      alive.delete(id)
      events?.onExit(id, 0)
    },
    isAlive: (id) => alive.has(id),
    subscribe: () => () => {},
    killAll: () => {},
  }
  return {
    host,
    spawned,
    bind: (e: PtyHostEvents) => (events = e),
    failNext: () => (failNextSpawn = true),
  }
}

describe('sessionService', () => {
  let repo: TerminalRepo
  let pty: ReturnType<typeof fakePtyHost>
  let updates: TerminalDTO[]
  let transitions: Array<[TerminalStatus, TerminalStatus]>
  let transcripts: Set<string>
  let service: SessionService

  const makeService = (overrides: Partial<SessionServiceDeps> = {}): SessionService =>
    createSessionService({
      repo,
      createHost: (events) => {
        pty.bind(events)
        return pty.host
      },
      claudeBin: 'claude.exe',
      claudeHome: 'C:\\home\\.claude',
      isDirectory: () => true,
      fileExists: (p) => transcripts.has(p.replaceAll('\\', '/')),
      onTerminalChanged: (t) => updates.push(t),
      onTransition: (prev, t) => transitions.push([prev, t.status]),
      readSummary: async () => 'Listo, arreglé el bug',
      ...overrides,
    })

  beforeEach(() => {
    repo = createTerminalRepo(openDatabase(':memory:'))
    pty = fakePtyHost()
    updates = []
    transitions = []
    transcripts = new Set()
    service = makeService()
  })

  test('create spawns claude with a fixed session id in the cwd', () => {
    const t = service.create({ title: 'API', cwd: 'E:\\repo' })
    expect(pty.spawned[0]?.args).toEqual(['--session-id', t.sessionId])
    expect(pty.spawned[0]?.cwd).toBe('E:\\repo')
    expect(t.status).toBe('idle')
    expect(t.isAlive).toBe(true)
  })

  test('create passes hook env and settings from launchExtras', () => {
    const s = makeService({ launchExtras: (r) => ({ settingsPath: 'C:\\hs.json', env: { AGENTDEVS_TERMINAL_ID: r.id } }) })
    const t = s.create({ title: 'API', cwd: 'E:\\repo' })
    expect(pty.spawned[0]?.args).toEqual(['--session-id', t.sessionId, '--settings', 'C:\\hs.json'])
    expect(pty.spawned[0]?.env).toEqual({ AGENTDEVS_TERMINAL_ID: t.id })
  })

  test('create rejects a cwd that is not a directory', () => {
    const bad = makeService({ isDirectory: () => false })
    expect(() => bad.create({ title: 'x', cwd: 'E:\\nope' })).toThrow(/no existe/)
  })

  test('a failed spawn on create leaves no orphan terminal behind', () => {
    pty.failNext()
    expect(() => service.create({ title: 'x', cwd: 'E:\\repo' })).toThrow(/No se pudo abrir Claude/)
    expect(service.list()).toHaveLength(0)
  })

  test('restoreAll resumes sessions that have a transcript', () => {
    const rec = repo.create({ title: 'A', cwd: 'E:\\repo', missionId: null })
    transcripts.add(`C:/home/.claude/projects/E--repo/${rec.sessionId}.jsonl`)
    service.restoreAll()
    expect(pty.spawned[0]?.args).toEqual(['--resume', rec.sessionId])
  })

  test('restoreAll starts fresh with the same id when there is no transcript yet', () => {
    const rec = repo.create({ title: 'A', cwd: 'E:\\repo', missionId: null })
    service.restoreAll()
    expect(pty.spawned[0]?.args).toEqual(['--session-id', rec.sessionId])
  })

  test('restoreAll skips terminals the user had exited', () => {
    const rec = repo.create({ title: 'A', cwd: 'E:\\repo', missionId: null })
    repo.update(rec.id, { status: 'exited' })
    service.restoreAll()
    expect(pty.spawned).toHaveLength(0)
  })

  test('restoreAll keeps going when one terminal fails to spawn', () => {
    const broken = repo.create({ title: 'A', cwd: 'E:\\a', missionId: null })
    const ok = repo.create({ title: 'B', cwd: 'E:\\b', missionId: null })
    pty.failNext()
    expect(() => service.restoreAll()).not.toThrow()
    expect(repo.findById(broken.id)).toMatchObject({ status: 'exited', lastSummary: expect.stringMatching(/ENOENT/) })
    expect(pty.spawned.map((s) => s.id)).toEqual([ok.id])
  })

  test('process exit marks the terminal as exited', () => {
    const t = service.create({ title: 'A', cwd: 'E:\\repo' })
    pty.host.kill(t.id)
    expect(updates.at(-1)).toMatchObject({ id: t.id, status: 'exited', isAlive: false })
  })

  test('server shutdown does not mark terminals as exited (so they restore)', () => {
    const t = service.create({ title: 'A', cwd: 'E:\\repo' })
    pty.host.killAll = () => pty.host.kill(t.id)
    service.shutdown()
    expect(repo.findById(t.id)?.status).toBe('idle')
  })

  test('remove kills and archives', () => {
    const t = service.create({ title: 'A', cwd: 'E:\\repo' })
    service.remove(t.id)
    expect(service.list()).toHaveLength(0)
  })

  test('Stop hook marks done with the transcript summary', async () => {
    const t = service.create({ title: 'A', cwd: 'E:\\repo' })
    await service.handleHook(t.id, { event: 'UserPromptSubmit', message: null, transcriptPath: null })
    const done = await service.handleHook(t.id, { event: 'Stop', message: null, transcriptPath: 'x.jsonl' })
    expect(done).toMatchObject({ status: 'done', lastSummary: 'Listo, arreglé el bug' })
    expect(transitions).toEqual([
      ['starting', 'idle'],
      ['idle', 'working'],
      ['working', 'done'],
    ])
  })

  test('AskUser hook marks needs_input with its message', async () => {
    const t = service.create({ title: 'A', cwd: 'E:\\repo' })
    const res = await service.handleHook(t.id, { event: 'AskUser', message: 'Propone un plan', transcriptPath: null })
    expect(res).toMatchObject({ status: 'needs_input', lastSummary: 'Propone un plan' })
  })

  test('a failing transcript read still marks the terminal as done', async () => {
    const s = makeService({
      readSummary: async () => {
        throw new Error('EBUSY')
      },
    })
    const t = s.create({ title: 'A', cwd: 'E:\\repo' })
    const res = await s.handleHook(t.id, { event: 'Stop', message: null, transcriptPath: 'x.jsonl' })
    expect(res?.status).toBe('done')
  })

  describe('importSession', () => {
    const sid = '77777777-7777-4777-8777-777777777777'
    const input = { sessionId: sid, cwd: 'E:\\repo', title: 'Login' }

    test('adopts the existing session id and resumes it', () => {
      transcripts.add(`C:/home/.claude/projects/E--repo/${sid}.jsonl`)
      const t = service.importSession(input)
      expect(t).toMatchObject({ sessionId: sid, title: 'Login', status: 'idle' })
      expect(pty.spawned[0]?.args).toEqual(['--resume', sid])
    })

    test('refuses to import the same session twice', () => {
      transcripts.add(`C:/home/.claude/projects/E--repo/${sid}.jsonl`)
      service.importSession(input)
      expect(() => service.importSession(input)).toThrow(/ya está/)
    })

    test('refuses when the transcript is not where --resume will look', () => {
      expect(() => service.importSession(input)).toThrow(/No encontré el historial/)
    })

    test('a failed spawn leaves nothing behind', () => {
      transcripts.add(`C:/home/.claude/projects/E--repo/${sid}.jsonl`)
      pty.failNext()
      expect(() => service.importSession(input)).toThrow(/No se pudo retomar/)
      expect(service.list()).toHaveLength(0)
    })
  })

  test('keystrokes on a terminal that is not waiting do not write or broadcast', () => {
    const t = service.create({ title: 'A', cwd: 'E:\\repo' })
    const before = updates.length
    service.applyEvent(t.id, { kind: 'user_input' })
    expect(updates.length).toBe(before)
  })
})
