import { beforeEach, describe, expect, test } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { openDatabase } from '../src/db.js'
import { createTerminalRepo } from '../src/terminalRepo.js'
import { createSessionService, type SessionService } from '../src/sessionService.js'
import type { PtyHost, SpawnOptions } from '../src/ptyHost.js'
import { createPmMcpServer, MAX_ACTIVE_WORKERS } from '../src/pmTools.js'

interface CallResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

describe('PM MCP tools', () => {
  let service: SessionService
  let spawned: SpawnOptions[]
  let written: Array<[string, string]>
  let client: Client
  let pmId: string
  let worktreeCount: number
  let repoAllowed: boolean

  beforeEach(async () => {
    spawned = []
    written = []
    worktreeCount = 0
    repoAllowed = true
    const alive = new Set<string>()
    const host: PtyHost = {
      spawn: (o) => {
        spawned.push(o)
        alive.add(o.id)
      },
      write: (id, data) => written.push([id, data]),
      resize: () => {},
      kill: () => {},
      isAlive: (id) => alive.has(id),
      subscribe: () => () => {},
      killAll: () => {},
    }
    service = createSessionService({
      repo: createTerminalRepo(openDatabase(':memory:')),
      createHost: () => host,
      claudeBin: 'claude.exe',
      claudeHome: 'C:\\h',
      isDirectory: () => true,
      fileExists: () => false,
      onTerminalChanged: () => {},
    })
    pmId = service.create({ title: 'PM', cwd: 'E:\\pm', role: 'pm' }).id

    const server = createPmMcpServer(pmId, {
      service,
      claudeHome: 'C:\\h',
      findRepoRoot: async (p) => (p.startsWith('E:\\repo') ? 'E:\\repo' : null),
      createWorktree: async ({ name }) => {
        worktreeCount++
        return { path: `E:\\repo\\.claude\\worktrees\\w${worktreeCount}`, branch: `agentdevs/${name}` }
      },
      readLastAssistantText: async () => 'REPORTE: listo',
      isRepoAllowed: async () => repoAllowed,
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: 'test', version: '1' })
    await client.connect(clientTransport)
  })

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallResult> =>
    (await client.callTool({ name, arguments: args })) as CallResult
  const json = (r: CallResult) => JSON.parse(r.content[0]?.text ?? 'null')

  const createWorker = (titulo = 'api') =>
    call('crear_worker', { repo: 'E:\\repo', titulo, tarea: 'Agregar endpoint de login', alcance: 'src/auth' })

  test('exposes the four PM tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['crear_worker', 'leer_reporte', 'listar_workers', 'mandar_mensaje'])
  })

  test('crear_worker launches claude in the worktree with the brief as first message', async () => {
    const res = await createWorker()
    expect(res.isError).toBeFalsy()
    const worker = spawned.at(-1)!
    expect(worker.cwd).toBe('E:\\repo\\.claude\\worktrees\\w1')
    const promptIdx = worker.args.indexOf('--')
    expect(worker.args[promptIdx + 1]).toMatch(/Agregar endpoint de login[\s\S]*src\/auth/)
    expect(json(await call('listar_workers'))[0]).toMatchObject({ titulo: 'api', rama: 'agentdevs/api', estado: 'idle' })
  })

  test('crear_worker rejects non-git folders and caps active workers', async () => {
    const bad = await call('crear_worker', { repo: 'C:\\nada', titulo: 'x', tarea: 'algo largo de hacer' })
    expect(bad.isError).toBe(true)
    for (let i = 0; i < MAX_ACTIVE_WORKERS; i++) await createWorker(`w${i}`)
    const over = await createWorker('extra')
    expect(over.isError).toBe(true)
    expect(over.content[0]?.text).toMatch(/máximo/)
  })

  test('leer_reporte returns the last answer, accepting the short id', async () => {
    const id = json(await createWorker()).creado.id as string
    const report = json(await call('leer_reporte', { worker_id: id.slice(0, 8) }))
    expect(report.ultima_respuesta).toBe('REPORTE: listo')
  })

  test('mandar_mensaje types into an idle worker but refuses a busy one', async () => {
    const id = json(await createWorker()).creado.id as string
    const sent = await call('mandar_mensaje', { worker_id: id, mensaje: 'Sumá tests\npor favor' })
    expect(sent.isError).toBeFalsy()
    expect(written).toContainEqual([id, 'Sumá tests por favor'])

    service.applyEvent(id, { kind: 'hook', event: 'UserPromptSubmit' })
    const busy = await call('mandar_mensaje', { worker_id: id, mensaje: 'otra cosa' })
    expect(busy.isError).toBe(true)
  })

  test('crear_worker refuses repos the user has not trusted', async () => {
    repoAllowed = false
    const res = await createWorker()
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toMatch(/confiaste/)
  })

  test('concurrent crear_worker calls cannot exceed the cap', async () => {
    const results = await Promise.all(Array.from({ length: MAX_ACTIVE_WORKERS + 2 }, (_, i) => createWorker(`c${i}`)))
    expect(results.filter((r) => !r.isError)).toHaveLength(MAX_ACTIVE_WORKERS)
  })

  test('mandar_mensaje never types into a worker waiting on the user (could approve a permission)', async () => {
    const id = json(await createWorker()).creado.id as string
    service.applyEvent(id, { kind: 'hook', event: 'Notification' })
    const res = await call('mandar_mensaje', { worker_id: id, mensaje: 'sí' })
    expect(res.isError).toBe(true)
    expect(written.filter(([wid]) => wid === id)).toEqual([])
  })

  test('the PM supervises terminals the user opened or imported, too', async () => {
    const manual = service.create({ title: 'IPs de Cloudflare', cwd: 'E:\\miproyecto' })
    const list = json(await call('listar_workers'))
    expect(list).toEqual([expect.objectContaining({ id: manual.id, titulo: 'IPs de Cloudflare', tipo: 'manual' })])
    expect(json(await call('leer_reporte', { worker_id: manual.id })).ultima_respuesta).toBe('REPORTE: listo')
    const sent = await call('mandar_mensaje', { worker_id: manual.id, mensaje: 'hola' })
    expect(sent.isError).toBeFalsy()
  })

  test('the PM never lists or messages itself', async () => {
    expect(json(await call('listar_workers'))).toEqual([])
    const res = await call('mandar_mensaje', { worker_id: pmId, mensaje: 'hola' })
    expect(res.isError).toBe(true)
  })

  test('manual terminals do not count against the worker cap', async () => {
    for (let i = 0; i < 6; i++) service.create({ title: `m${i}`, cwd: 'E:\\m' })
    const res = await createWorker()
    expect(res.isError).toBeFalsy()
  })
})
