import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseTranscriptMeta, scanRecentSessions } from '../src/sessionScanner.js'

const line = (o: unknown) => JSON.stringify(o)

describe('parseTranscriptMeta', () => {
  const head = [
    line({ type: 'mode', mode: 'normal' }),
    line({ type: 'user', cwd: 'E:\\Proyectos\\miproyecto', gitBranch: 'main', message: { content: 'arreglá el login por favor' } }),
    line({ type: 'ai-title', aiTitle: 'Arreglo del login' }),
  ].join('\n')

  test('takes the launch cwd from the first record that has one', () => {
    const tail = line({ type: 'user', cwd: 'E:\\Proyectos\\miproyecto\\sub', gitBranch: 'feat/x' })
    expect(parseTranscriptMeta(head, tail)).toMatchObject({
      launchCwd: 'E:\\Proyectos\\miproyecto',
      gitBranch: 'feat/x',
      title: 'Arreglo del login',
    })
  })

  test('a custom title wins over the AI title, latest occurrence wins', () => {
    const tail = [line({ type: 'ai-title', aiTitle: 'Otro' }), line({ type: 'custom-title', customTitle: 'Mi nombre' })].join('\n')
    expect(parseTranscriptMeta(head, tail).title).toBe('Mi nombre')
  })

  test('falls back to the first real user prompt, skipping meta and pasted noise', () => {
    const h = [
      line({ type: 'user', isMeta: true, cwd: 'E:\\a', message: { content: '<command-name>x</command-name>' } }),
      line({ type: 'user', message: { content: [{ type: 'text', text: 'hacé  el\ndeploy' }] } }),
    ].join('\n')
    expect(parseTranscriptMeta(h, '').title).toBe('hacé el deploy')
  })

  test('returns nulls when nothing is usable', () => {
    expect(parseTranscriptMeta('{"bro', '')).toEqual({ launchCwd: null, gitBranch: null, title: null })
  })
})

describe('scanRecentSessions', () => {
  function makeHome() {
    const home = mkdtempSync(join(tmpdir(), 'agd-scan-'))
    const project = join(home, 'projects', 'E--Proyectos-miproyecto')
    mkdirSync(join(project, 'subagents'), { recursive: true })
    return { home, project }
  }

  const transcript = (cwd: string, title: string) =>
    [line({ type: 'user', cwd, message: { content: 'hola' } }), line({ type: 'ai-title', aiTitle: title })].join('\n')

  test('lists recent top-level sessions with resumable cwd, newest first', async () => {
    const { home, project } = makeHome()
    const old = '11111111-1111-4111-8111-111111111111'
    const a = '22222222-2222-4222-8222-222222222222'
    const b = '33333333-3333-4333-8333-333333333333'
    writeFileSync(join(project, `${a}.jsonl`), transcript('E:\\Proyectos\\miproyecto', 'A'))
    writeFileSync(join(project, `${b}.jsonl`), transcript('E:\\Proyectos\\miproyecto', 'B'))
    writeFileSync(join(project, `${old}.jsonl`), transcript('E:\\Proyectos\\miproyecto', 'Old'))
    writeFileSync(join(project, 'subagents', 'x.jsonl'), transcript('E:\\Proyectos\\miproyecto', 'Sub'))
    const now = Date.now() / 1000
    utimesSync(join(project, `${a}.jsonl`), now - 60, now - 60)
    utimesSync(join(project, `${b}.jsonl`), now - 10, now - 10)
    utimesSync(join(project, `${old}.jsonl`), now - 3 * 86400, now - 3 * 86400)

    const sessions = await scanRecentSessions({ claudeHome: home, maxAgeMs: 86400_000, excludeIds: new Set() })
    expect(sessions.map((s) => s.title)).toEqual(['B', 'A'])
    expect(sessions[0]).toMatchObject({ sessionId: b, cwd: 'E:\\Proyectos\\miproyecto' })
  })

  test('skips excluded ids and sessions whose cwd does not match their folder', async () => {
    const { home, project } = makeHome()
    const keep = '44444444-4444-4444-8444-444444444444'
    const excluded = '55555555-5555-4555-8555-555555555555'
    const mismatch = '66666666-6666-4666-8666-666666666666'
    writeFileSync(join(project, `${keep}.jsonl`), transcript('E:\\Proyectos\\miproyecto', 'Keep'))
    writeFileSync(join(project, `${excluded}.jsonl`), transcript('E:\\Proyectos\\miproyecto', 'Ex'))
    writeFileSync(join(project, `${mismatch}.jsonl`), transcript('C:\\otro', 'Mismatch'))

    const sessions = await scanRecentSessions({ claudeHome: home, maxAgeMs: 86400_000, excludeIds: new Set([excluded]) })
    expect(sessions.map((s) => s.sessionId)).toEqual([keep])
  })

  test('returns an empty list when the projects folder does not exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agd-empty-'))
    expect(await scanRecentSessions({ claudeHome: home, maxAgeMs: 1000, excludeIds: new Set() })).toEqual([])
  })
})
