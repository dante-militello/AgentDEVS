import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp, HOOK_TOKEN_HEADER, TOKEN_COOKIE } from '../src/app.js'
import { hookTokenFor } from '../src/security.js'
import { openDatabase } from '../src/db.js'
import { createTerminalRepo } from '../src/terminalRepo.js'
import { createSessionService } from '../src/sessionService.js'
import type { PtyHost } from '../src/ptyHost.js'

const TOKEN = 'a'.repeat(64)
const HOST = 'localhost:4317'
const SCANNED = '88888888-8888-4888-8888-888888888888'

const nullHost: PtyHost = {
  spawn: () => {},
  write: () => {},
  resize: () => {},
  kill: () => {},
  isAlive: () => true,
  subscribe: () => () => {},
  killAll: () => {},
}

describe('app', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    const repo = createTerminalRepo(openDatabase(':memory:'))
    const built = await buildApp(
      {
        port: 4317,
        token: TOKEN,
        webDistDir: 'Z:\\does-not-exist',
        scanSessions: async () => [
          { sessionId: SCANNED, cwd: 'E:\\ok', title: 'Desde disco', gitBranch: 'main', lastActivityAt: 1, sizeBytes: 1 },
        ],
      },
      (b) =>
        createSessionService({
          repo,
          createHost: () => nullHost,
          claudeBin: 'claude.exe',
          claudeHome: 'C:\\h',
          isDirectory: (p) => p === 'E:\\ok',
          fileExists: (p) => p.includes(SCANNED),
          onTerminalChanged: (terminal) => b.terminalChanged({ type: 'terminal', terminal }),
        }),
    )
    app = built.app
  })

  afterEach(async () => {
    await app.close()
  })

  const auth = { host: HOST, cookie: `${TOKEN_COOKIE}=${TOKEN}` }

  test('rejects foreign Host headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session', headers: { host: 'evil.com:4317' } })
    expect(res.statusCode).toBe(403)
  })

  test('rejects cross-site origins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { host: HOST, origin: 'https://evil.com' },
    })
    expect(res.statusCode).toBe(403)
  })

  test('session endpoint issues the strict httpOnly cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session', headers: { host: HOST } })
    expect(res.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict')
  })

  test('api requires the token cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/terminals', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })

  test.each(['/%61pi/terminals', '/API/terminals', '//api/terminals', '/%77s'])(
    'percent-encoded or odd paths cannot skip auth (%s)',
    async (url) => {
      const res = await app.inject({ method: 'GET', url, headers: { host: HOST } })
      expect([401, 404]).toContain(res.statusCode)
      expect(res.statusCode === 200).toBe(false)
    },
  )

  test('hook endpoint requires the hook token header, not the cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hooks/00000000-0000-4000-8000-000000000000',
      headers: { host: '127.0.0.1:4317' },
      payload: { hook_event_name: 'Stop' },
    })
    expect(res.statusCode).toBe(401)
  })

  test('a valid hook updates status, but a token for another terminal is rejected', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/terminals', headers: auth, payload: { title: 'A', cwd: 'E:\\ok' } })
    const id = created.json().data.id as string
    const otherToken = hookTokenFor(TOKEN, '11111111-1111-4111-8111-111111111111')

    const rejected = await app.inject({
      method: 'POST',
      url: `/hooks/${id}`,
      headers: { host: '127.0.0.1:4317', [HOOK_TOKEN_HEADER]: otherToken },
      payload: { hook_event_name: 'UserPromptSubmit' },
    })
    expect(rejected.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'POST',
      url: `/hooks/${id}`,
      headers: { host: '127.0.0.1:4317', [HOOK_TOKEN_HEADER]: hookTokenFor(TOKEN, id) },
      payload: { hook_event_name: 'UserPromptSubmit' },
    })
    expect(ok.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/terminals', headers: auth })
    expect(list.json().data[0].status).toBe('working')
  })

  test('the dev web origin is rejected unless dev mode enabled it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { host: HOST, origin: 'http://localhost:5173' },
    })
    expect(res.statusCode).toBe(403)
  })

  test('import resumes scanned sessions using the folder from disk and reports unknown ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/import',
      headers: auth,
      payload: { sessions: [{ sessionId: SCANNED }, { sessionId: '99999999-9999-4999-8999-999999999999' }] },
    })
    const body = res.json().data
    expect(body.imported).toHaveLength(1)
    expect(body.imported[0]).toMatchObject({ sessionId: SCANNED, cwd: 'E:\\ok', title: 'Desde disco' })
    expect(body.errors[0]).toMatch(/No encontré/)
  })

  test('creates a terminal with valid input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      headers: auth,
      payload: { title: 'API', cwd: 'E:\\ok' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('idle')
  })

  test('returns 400 with a friendly message for a missing folder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      headers: auth,
      payload: { title: 'API', cwd: 'E:\\nope' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/no existe/)
  })

  test('returns 400 on schema violations', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/terminals', headers: auth, payload: { title: '' } })
    expect(res.statusCode).toBe(400)
  })
})
