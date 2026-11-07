import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createWorktree, findRepoRoot, slugify } from '../src/worktrees.js'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('slugify', () => {
  test('makes a safe branch/folder name', () => {
    expect(slugify('Login con Google (API)!')).toBe('login-con-google-api')
    expect(slugify('Ñandú & Café')).toBe('nandu-cafe')
  })

  test('never returns an empty slug and caps length', () => {
    expect(slugify('!!!')).toBe('worker')
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(40)
  })
})

describe('worktrees', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'agd-repo-'))
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t')
    git(repo, 'config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), 'hola')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'init')
  })

  test('findRepoRoot resolves the top level from a subfolder and rejects non-repos', async () => {
    expect(await findRepoRoot(repo)).toBeTruthy()
    expect(await findRepoRoot(tmpdir())).toBeNull()
  })

  test('creates a worktree on a new agentdevs/ branch under .claude/worktrees', async () => {
    const wt = await createWorktree({ repoRoot: repo, name: 'Login API' })
    expect(wt.branch).toBe('agentdevs/login-api')
    expect(wt.path.replaceAll('\\', '/')).toMatch(/\.claude\/worktrees\/login-api$/)
    expect(existsSync(join(wt.path, 'a.txt'))).toBe(true)
    expect(git(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('agentdevs/login-api')
  })

  test('picks a free name when the slug is taken', async () => {
    const first = await createWorktree({ repoRoot: repo, name: 'ui' })
    const second = await createWorktree({ repoRoot: repo, name: 'ui' })
    expect(first.branch).toBe('agentdevs/ui')
    expect(second.branch).toBe('agentdevs/ui-2')
  })

  test('keeps the worktrees folder out of git status', async () => {
    await createWorktree({ repoRoot: repo, name: 'x' })
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})
