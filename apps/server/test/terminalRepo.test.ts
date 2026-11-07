import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase } from '../src/db.js'
import { createTerminalRepo, type TerminalRepo } from '../src/terminalRepo.js'

describe('terminalRepo', () => {
  let repo: TerminalRepo

  beforeEach(() => {
    repo = createTerminalRepo(openDatabase(':memory:'))
  })

  test('creates and reads back a terminal', () => {
    const created = repo.create({ title: 'API', cwd: 'E:\\x', missionId: null })
    expect(created.status).toBe('starting')
    expect(created.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(repo.findById(created.id)).toEqual(created)
  })

  test('lists terminals ordered by creation', () => {
    const a = repo.create({ title: 'A', cwd: 'E:\\a', missionId: null })
    const b = repo.create({ title: 'B', cwd: 'E:\\b', missionId: null })
    expect(repo.findAll().map((t) => t.id)).toEqual([a.id, b.id])
  })

  test('update returns a new record without mutating the old one', () => {
    const t = repo.create({ title: 'A', cwd: 'E:\\a', missionId: null })
    const updated = repo.update(t.id, { status: 'working', lastSummary: 'hola' })
    expect(updated?.status).toBe('working')
    expect(updated?.lastSummary).toBe('hola')
    expect(t.status).toBe('starting')
  })

  test('findRestorable excludes archived terminals', () => {
    const keep = repo.create({ title: 'A', cwd: 'E:\\a', missionId: null })
    const gone = repo.create({ title: 'B', cwd: 'E:\\b', missionId: null })
    repo.archive(gone.id)
    expect(repo.findRestorable().map((t) => t.id)).toEqual([keep.id])
    expect(repo.findById(gone.id)).toBeNull()
  })
})

describe('terminalRepo roles and worktrees', () => {
  test('stores role, parent, repo, worktree and branch', () => {
    const repo = createTerminalRepo(openDatabase(':memory:'))
    const pm = repo.create({ title: 'PM', cwd: 'E:\\pm', missionId: null, role: 'pm' })
    const w = repo.create({
      title: 'API',
      cwd: 'E:\\repo\\.claude\\worktrees\\api',
      missionId: null,
      role: 'worker',
      parentId: pm.id,
      repoPath: 'E:\\repo',
      branch: 'agentdevs/api',
    })
    expect(w).toMatchObject({ role: 'worker', parentId: pm.id, repoPath: 'E:\\repo', branch: 'agentdevs/api' })
    expect(repo.create({ title: 'x', cwd: 'E:\\x', missionId: null })).toMatchObject({ role: 'manual', parentId: null })
  })

  test('migrates an old database that lacks the new columns', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const path = join(mkdtempSync(join(tmpdir(), 'agd-mig-')), 'old.db')
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE terminals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL, cwd TEXT NOT NULL,
      mission_id TEXT, status TEXT NOT NULL, last_summary TEXT, last_activity_at INTEGER NOT NULL, created_at INTEGER NOT NULL, archived_at INTEGER);
      INSERT INTO terminals VALUES ('t1','s1','Vieja','E:\a',NULL,'idle',NULL,1,1,NULL);`)
    old.close()
    const repo = createTerminalRepo(openDatabase(path))
    expect(repo.findById('t1')).toMatchObject({ title: 'Vieja', role: 'manual', parentId: null })
  })
})
