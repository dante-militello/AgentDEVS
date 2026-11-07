import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  mission_id TEXT,
  status TEXT NOT NULL,
  last_summary TEXT,
  last_activity_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_terminals_active ON terminals(archived_at, created_at);
`

/** Columns added after the first release; applied to existing databases on open. */
const ADDED_COLUMNS: ReadonlyArray<[name: string, definition: string]> = [
  ['role', "TEXT NOT NULL DEFAULT 'manual'"],
  ['parent_id', 'TEXT'],
  ['repo_path', 'TEXT'],
  ['branch', 'TEXT'],
]

function migrate(db: DatabaseSync): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(terminals)').all() as Array<{ name: string }>).map((c) => c.name),
  )
  for (const [name, definition] of ADDED_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE terminals ADD COLUMN ${name} ${definition}`)
  }
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(SCHEMA)
  migrate(db)
  return db
}
