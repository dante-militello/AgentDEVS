import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SLUG_MAX = 40
const MAX_NAME_ATTEMPTS = 50
const WORKTREES_DIR = join('.claude', 'worktrees')
const EXCLUDE_LINE = '/.claude/worktrees/'

export interface Worktree {
  path: string
  branch: string
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  return slug || 'worker'
}

/** Arguments are always passed as an array: no shell, no injection. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true })
  return stdout.trim()
}

export async function findRepoRoot(path: string): Promise<string | null> {
  try {
    return await git(path, 'rev-parse', '--show-toplevel')
  } catch {
    return null
  }
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(repoRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
    return true
  } catch {
    return false
  }
}

/** Keeps .claude/worktrees out of `git status` without touching the tracked .gitignore. */
async function ensureExcluded(repoRoot: string): Promise<void> {
  const excludePath = await git(repoRoot, 'rev-parse', '--git-path', 'info/exclude')
  // --git-path may return an absolute path (linked worktrees): resolve handles both cases.
  const absolute = resolve(repoRoot, excludePath)
  const current = await readFile(absolute, 'utf8').catch(() => '')
  if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return
  await mkdir(join(absolute, '..'), { recursive: true })
  await appendFile(absolute, `${current.endsWith('\n') || current === '' ? '' : '\n'}${EXCLUDE_LINE}\n`)
}

export interface CreateWorktreeOptions {
  repoRoot: string
  name: string
  baseRef?: string
}

/** Creates `<repo>/.claude/worktrees/<slug>` on a new `agentdevs/<slug>` branch from baseRef (HEAD by default). */
export async function createWorktree({ repoRoot, name, baseRef = 'HEAD' }: CreateWorktreeOptions): Promise<Worktree> {
  await ensureExcluded(repoRoot)
  const base = slugify(name)
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`
    const branch = `agentdevs/${slug}`
    const path = join(repoRoot, WORKTREES_DIR, slug)
    if (await branchExists(repoRoot, branch)) continue
    try {
      await git(repoRoot, 'worktree', 'add', '-b', branch, path, baseRef)
      return { path, branch }
    } catch (error: unknown) {
      // Folder already in use by another worktree: try the next name.
      if (error instanceof Error && /already exists/i.test(error.message)) continue
      throw error
    }
  }
  throw new Error(`No pude encontrar un nombre libre para la worktree "${name}"`)
}
