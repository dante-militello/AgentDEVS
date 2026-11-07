import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import { createTerminalRepo } from '../src/terminalRepo.js'
import { createSessionService, type SessionService } from '../src/sessionService.js'
import type { PtyHost } from '../src/ptyHost.js'
import { createPmMcpServer } from '../src/pmTools.js'
import { pmTokenFor } from '../src/security.js'

const TOKEN = 'b'.repeat(64)
const nullHost: PtyHost = {
  spawn: () => {},
  write: () => {},
  resize: () => {},
  kill: () => {},
  isAlive: () => true,
  subscribe: () => () => {},
  killAll: () => {},
}

describe('MCP route', () => {
  let app: FastifyInstance
  let service: SessionService
  let pmId: string
  let manualId: string

  beforeEach(async () => {
    const repo = createTerminalRepo(openDatabase(':memory:'))
    let svc: SessionService | null = null
    const built = await buildApp(
      {
        port: 4317,
        token: TOKEN,
        webDistDir: 'Z:\\none',
        createMcpServer: (id) =>
          createPmMcpServer(id, {
            service: svc!,
            claudeHome: 'C:\\h',
            findRepoRoot: async () => null,
            createWorktree: async () => ({ path: '', branch: '' }),
            readLastAssistantText: async () => null,
            isRepoAllowed: async () => true,
          }),
      },
      () => {
        svc = createSessionService({
          repo,
          createHost: () => nullHost,
          claudeBin: 'claude.exe',
          claudeHome: 'C:\\h',
          isDirectory: () => true,
          fileExists: () => false,
          onTerminalChanged: () => {},
        })
        return svc
      },
    )
    app = built.app
    service = built.service
    pmId = service.create({ title: 'PM', cwd: 'E:\\pm', role: 'pm' }).id
    manualId = service.create({ title: 'm', cwd: 'E:\\m' }).id
  })

  afterEach(async () => {
    await app.close()
  })

  const listTools = (id: string, token: string) =>
    app.inject({
      method: 'POST',
      url: `/mcp/${id}`,
      headers: {
        host: '127.0.0.1:4317',
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

  test('rejects a missing or foreign token', async () => {
    expect((await listTools(pmId, 'nope')).statusCode).toBe(401)
    expect((await listTools(pmId, pmTokenFor(TOKEN, manualId))).statusCode).toBe(401)
  })

  test('serves the PM tools over HTTP with the right token', async () => {
    const res = await listTools(pmId, pmTokenFor(TOKEN, pmId))
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('crear_worker')
  })

  test('a valid token for a non-PM terminal still gets no tools', async () => {
    const res = await listTools(manualId, pmTokenFor(TOKEN, manualId))
    expect(res.statusCode).toBe(404)
  })
})
