import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTrustGate, isPathTrusted, screenText } from '../src/trustGate.js'

describe('isPathTrusted', () => {
  const projects = {
    'E:/Proyectos/miproyecto': { hasTrustDialogAccepted: true },
    'E:/Proyectos/otro': { hasTrustDialogAccepted: false },
  }

  test('trusts the repo itself and anything inside a trusted folder', () => {
    expect(isPathTrusted(projects, 'E:\\Proyectos\\miproyecto')).toBe(true)
    expect(isPathTrusted(projects, 'e:/proyectos/MIPROYECTO/sub')).toBe(true)
  })

  test('does not trust siblings with a common prefix or explicitly untrusted folders', () => {
    expect(isPathTrusted(projects, 'E:/Proyectos/miproyecto_privado')).toBe(false)
    expect(isPathTrusted(projects, 'E:/Proyectos/otro')).toBe(false)
    expect(isPathTrusted(projects, 'E:/Proyectos')).toBe(false)
  })
})

describe('screenText', () => {
  test('strips escape sequences and spacing so the prompt text can be matched', () => {
    expect(screenText('\x1b[1mYes,\x1b[0m\x1b[1CI trust this folder')).toBe('Yes,Itrustthisfolder')
  })
})

describe('trustGate', () => {
  const TRUST_PROMPT = '❯ No, exit\r\n  Yes, I trust this folder\r\nEnter to confirm · Esc to cancel'
  let writes: Array<[string, string]>
  let attention: Array<[string, string]>
  let repoTrusted: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    writes = []
    attention = []
    repoTrusted = true
  })
  afterEach(() => vi.useRealTimers())

  const gate = () =>
    createTrustGate({
      getTerminal: (id) =>
        id === 'w'
          ? { role: 'worker', repoPath: 'E:\\Proyectos\\miproyecto', cwd: 'E:\\Proyectos\\miproyecto\\.claude\\worktrees\\x' }
          : id === 'pm'
            ? { role: 'pm', repoPath: null, cwd: 'E:\\Proyectos\\AgentDEVS\\pm' }
            : { role: 'manual', repoPath: null, cwd: 'E:\\x' },
      isRepoTrusted: () => repoTrusted,
      write: (id, data) => writes.push([id, data]),
      needsUser: (id, reason) => attention.push([id, reason]),
    })

  test('accepts the dialog once for a worker whose repo the user already trusts', async () => {
    const g = gate()
    g.watch('w')
    g.onOutput('w', TRUST_PROMPT.slice(0, 10))
    g.onOutput('w', TRUST_PROMPT.slice(10))
    await vi.runAllTimersAsync()
    expect(writes).toEqual([
      ['w', '\x1b[B'],
      ['w', '\r'],
    ])
    g.onOutput('w', TRUST_PROMPT)
    await vi.runAllTimersAsync()
    expect(writes).toHaveLength(2)
  })

  test('asks the user instead when the repo is not trusted', async () => {
    repoTrusted = false
    const g = gate()
    g.watch('w')
    g.onOutput('w', TRUST_PROMPT)
    await vi.runAllTimersAsync()
    expect(writes).toEqual([])
    expect(attention[0]?.[1]).toMatch(/confianza/)
  })

  test('also answers for the PM, judging its own folder', async () => {
    const g = gate()
    g.watch('pm')
    g.onOutput('pm', TRUST_PROMPT)
    await vi.runAllTimersAsync()
    expect(writes.map(([id]) => id)).toEqual(['pm', 'pm'])
  })

  test('a worker printing the phrase alone does not trigger keystrokes', async () => {
    const g = gate()
    g.watch('w')
    g.onOutput('w', 'El usuario dijo: Yes, I trust this folder')
    await vi.runAllTimersAsync()
    expect(writes).toEqual([])
  })

  test('ignores terminals it is not watching and stops after the watch window', async () => {
    const g = gate()
    g.onOutput('m', TRUST_PROMPT)
    g.watch('w')
    vi.advanceTimersByTime(120_000)
    g.onOutput('w', TRUST_PROMPT)
    await vi.runAllTimersAsync()
    expect(writes).toEqual([])
  })
})
