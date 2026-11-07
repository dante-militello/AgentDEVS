import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { TerminalRole, TerminalStatus } from '@agentdevs/shared'

export interface TerminalRecord {
  id: string
  sessionId: string
  title: string
  cwd: string
  missionId: string | null
  role: TerminalRole
  parentId: string | null
  repoPath: string | null
  branch: string | null
  status: TerminalStatus
  lastSummary: string | null
  lastActivityAt: number
  createdAt: number
}

export interface NewTerminal {
  title: string
  cwd: string
  missionId: string | null
  role?: TerminalRole
  parentId?: string | null
  repoPath?: string | null
  branch?: string | null
  /** Set when adopting an existing Claude session; otherwise a fresh one is generated. */
  sessionId?: string
}

export type TerminalPatch = Partial<Pick<TerminalRecord, 'status' | 'lastSummary' | 'title' | 'lastActivityAt'>>

export interface TerminalRepo {
  create(input: NewTerminal): TerminalRecord
  findById(id: string): TerminalRecord | null
  findAll(): TerminalRecord[]
  findRestorable(): TerminalRecord[]
  /** Session IDs of active (non-archived) terminals, to avoid importing the same session twice. */
  allSessionIds(): Set<string>
  update(id: string, patch: TerminalPatch): TerminalRecord | null
  archive(id: string): void
}

interface Row {
  id: string
  session_id: string
  title: string
  cwd: string
  mission_id: string | null
  role: string
  parent_id: string | null
  repo_path: string | null
  branch: string | null
  status: string
  last_summary: string | null
  last_activity_at: number
  created_at: number
}

function toRecord(row: Row): TerminalRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    cwd: row.cwd,
    missionId: row.mission_id,
    role: row.role as TerminalRole,
    parentId: row.parent_id,
    repoPath: row.repo_path,
    branch: row.branch,
    status: row.status as TerminalStatus,
    lastSummary: row.last_summary,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  }
}

export function createTerminalRepo(db: DatabaseSync): TerminalRepo {
  const insert = db.prepare(
    `INSERT INTO terminals (id, session_id, title, cwd, mission_id, role, parent_id, repo_path, branch, status, last_summary, last_activity_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
  const selectOne = db.prepare('SELECT * FROM terminals WHERE id = ? AND archived_at IS NULL')
  const selectActive = db.prepare('SELECT * FROM terminals WHERE archived_at IS NULL ORDER BY created_at, rowid')
  const updateStmt = db.prepare(
    `UPDATE terminals SET status = ?, last_summary = ?, title = ?, last_activity_at = ? WHERE id = ?`,
  )
  const archiveStmt = db.prepare('UPDATE terminals SET archived_at = ? WHERE id = ?')
  const selectActiveSessionIds = db.prepare('SELECT session_id FROM terminals WHERE archived_at IS NULL')

  const findById = (id: string): TerminalRecord | null => {
    const row = selectOne.get(id) as Row | undefined
    return row ? toRecord(row) : null
  }

  const findAll = (): TerminalRecord[] => (selectActive.all() as unknown as Row[]).map(toRecord)

  return {
    create(input) {
      const now = Date.now()
      const id = randomUUID()
      insert.run(
        id,
        input.sessionId ?? randomUUID(),
        input.title,
        input.cwd,
        input.missionId,
        input.role ?? 'manual',
        input.parentId ?? null,
        input.repoPath ?? null,
        input.branch ?? null,
        'starting',
        now,
        now,
      )
      const created = findById(id)
      if (!created) throw new Error(`Failed to persist terminal ${id}`)
      return created
    },
    findById,
    findAll,
    findRestorable: findAll,
    allSessionIds() {
      const rows = selectActiveSessionIds.all() as Array<{ session_id: string }>
      return new Set(rows.map((r) => r.session_id))
    },
    update(id, patch) {
      const current = findById(id)
      if (!current) return null
      const next: TerminalRecord = { ...current, ...patch }
      updateStmt.run(next.status, next.lastSummary, next.title, next.lastActivityAt, id)
      return next
    },
    archive(id) {
      archiveStmt.run(Date.now(), id)
    },
  }
}
