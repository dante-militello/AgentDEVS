import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RecentSessionDTO } from '@agentdevs/shared'
import { encodeProjectDir } from './claudeCommand.js'

const HEAD_BYTES = 128 * 1024
const TAIL_BYTES = 256 * 1024
const TITLE_MAX_CHARS = 90
const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

export interface TranscriptMeta {
  launchCwd: string | null
  gitBranch: string | null
  title: string | null
}

interface Entry {
  type?: unknown
  cwd?: unknown
  gitBranch?: unknown
  isMeta?: unknown
  aiTitle?: unknown
  customTitle?: unknown
  message?: { content?: unknown }
}

function parseLines(text: string): Entry[] {
  const entries: Entry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      entries.push(JSON.parse(line) as Entry)
    } catch {
      // Partial line at a chunk boundary.
    }
  }
  return entries
}

function clean(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TITLE_MAX_CHARS ? `${flat.slice(0, TITLE_MAX_CHARS - 1)}…` : flat
}

function promptText(entry: Entry): string | null {
  if (entry.type !== 'user' || entry.isMeta) return null
  const content = entry.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join(' ')
        : ''
  const firstPart = text.split('<pasted_content')[0] ?? ''
  if (!firstPart.trim() || firstPart.trimStart().startsWith('<')) return null
  return clean(firstPart)
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** Extracts what we need to show and resume a session from the start and end of its transcript. */
export function parseTranscriptMeta(head: string, tail: string): TranscriptMeta {
  const headEntries = parseLines(head)
  const all = [...headEntries, ...parseLines(tail)]
  const launchCwd = headEntries.map((e) => asString(e.cwd)).find(Boolean) ?? null
  const gitBranch = all.map((e) => asString(e.gitBranch)).filter(Boolean).at(-1) ?? null
  const customTitle = all.map((e) => (e.type === 'custom-title' ? asString(e.customTitle) : null)).filter(Boolean).at(-1)
  const aiTitle = all.map((e) => (e.type === 'ai-title' ? asString(e.aiTitle) : null)).filter(Boolean).at(-1)
  const firstPrompt = headEntries.map(promptText).find(Boolean)
  const title = customTitle ?? aiTitle ?? firstPrompt ?? null
  return { launchCwd, gitBranch, title: title ? clean(title) : null }
}

async function readHeadAndTail(path: string, size: number): Promise<{ head: string; tail: string }> {
  const handle = await open(path, 'r')
  try {
    const headLength = Math.min(size, HEAD_BYTES)
    const head = Buffer.alloc(headLength)
    await handle.read(head, 0, headLength, 0)
    const tailLength = Math.min(Math.max(size - headLength, 0), TAIL_BYTES)
    const tail = Buffer.alloc(tailLength)
    if (tailLength > 0) await handle.read(tail, 0, tailLength, size - tailLength)
    return { head: head.toString('utf8'), tail: tail.toString('utf8') }
  } finally {
    await handle.close()
  }
}

export interface ScanOptions {
  claudeHome: string
  maxAgeMs: number
  excludeIds: ReadonlySet<string>
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/** Finds recently active Claude Code sessions that can be resumed from their launch folder. */
export async function scanRecentSessions({ claudeHome, maxAgeMs, excludeIds }: ScanOptions): Promise<RecentSessionDTO[]> {
  const projectsDir = join(claudeHome, 'projects')
  const cutoff = Date.now() - maxAgeMs
  const results: RecentSessionDTO[] = []

  for (const projectDir of await listDirs(projectsDir)) {
    const dirPath = join(projectsDir, projectDir)
    for (const file of await readdir(dirPath).catch(() => [] as string[])) {
      const sessionId = SESSION_FILE.exec(file)?.[1]
      if (!sessionId || excludeIds.has(sessionId)) continue
      const path = join(dirPath, file)
      const info = await stat(path).catch(() => null)
      if (!info || !info.isFile() || info.mtimeMs < cutoff) continue
      const { head, tail } = await readHeadAndTail(path, info.size)
      const meta = parseTranscriptMeta(head, tail)
      // --resume only finds the transcript when launched from the same folder it was created in.
      if (!meta.launchCwd || encodeProjectDir(meta.launchCwd) !== projectDir) continue
      results.push({
        sessionId,
        cwd: meta.launchCwd,
        title: meta.title ?? 'Sesión sin título',
        gitBranch: meta.gitBranch,
        lastActivityAt: Math.round(info.mtimeMs),
        sizeBytes: info.size,
      })
    }
  }
  return results.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}
