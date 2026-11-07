import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { z } from 'zod'
import {
  ClientMessageSchema,
  CreateTerminalSchema,
  ImportSessionsSchema,
  type RecentSessionDTO,
  type ServerMessage,
  type TerminalDTO,
} from '@agentdevs/shared'
import { parseHookPayload } from './hooks.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { hookTokenFor, isAllowedHost, isAllowedOrigin, pmTokenFor, tokensMatch } from './security.js'
import { SessionError, type SessionService } from './sessionService.js'

export const TOKEN_COOKIE = 'agentdevs_token'
export const HOOK_TOKEN_HEADER = 'x-agentdevs-hook-token'

/** A browser that stops reading would make the server buffer pty output forever. */
const MAX_WS_BUFFERED_BYTES = 8 * 1024 * 1024
const PUBLIC_ROUTES = new Set(['/api/session', '/*'])
const HOOK_ROUTE = '/hooks/:terminalId'
const MCP_ROUTE = '/mcp/:pmId'

export interface AppOptions {
  port: number
  /** Only set in dev: the Vite dev server origin that may call the API. */
  devWebPort?: number
  token: string
  webDistDir: string
  logger?: boolean
  /** Lists resumable Claude sessions on disk that AgentDEVS does not manage yet. */
  scanSessions?: () => Promise<RecentSessionDTO[]>
  /** Builds the MCP server for a PM terminal (one per request). */
  createMcpServer?: (pmId: string) => McpServer
  /** Opens the PM terminal, or returns the existing one. */
  openPm?: () => TerminalDTO
}

export interface Broadcaster {
  terminalChanged: (message: ServerMessage) => void
}

const TerminalIdParams = z.object({ terminalId: z.uuid() })
const PmParams = z.object({ pmId: z.uuid() })
const IdParams = z.object({ id: z.uuid() })

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return
  if (socket.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
    // The client reconnects and re-attaches with a fresh snapshot.
    socket.close(1013, 'Client too slow')
    return
  }
  socket.send(JSON.stringify(message))
}

function parseId(params: unknown): string {
  const parsed = IdParams.safeParse(params)
  if (!parsed.success) throw new SessionError('ID inválido')
  return parsed.data.id
}

export async function buildApp(
  options: AppOptions,
  createService: (broadcaster: Broadcaster) => SessionService,
): Promise<{ app: FastifyInstance; service: SessionService }> {
  const app = Fastify({ logger: options.logger ?? false })
  const extraPorts = options.devWebPort ? [options.devWebPort] : []
  const allowedPorts = [options.port, ...extraPorts]
  const clients = new Set<WebSocket>()

  const broadcaster: Broadcaster = {
    terminalChanged: (message) => {
      for (const socket of clients) send(socket, message)
    },
  }
  const service = createService(broadcaster)

  const hasCookieToken = (req: FastifyRequest): boolean =>
    tokensMatch(readCookie(req.headers.cookie, TOKEN_COOKIE), options.token)

  const hasHookToken = (req: FastifyRequest): boolean => {
    const params = TerminalIdParams.safeParse(req.params)
    const header = req.headers[HOOK_TOKEN_HEADER]
    return (
      params.success &&
      typeof header === 'string' &&
      tokensMatch(header, hookTokenFor(options.token, params.data.terminalId))
    )
  }

  const hasPmToken = (req: FastifyRequest): boolean => {
    const params = PmParams.safeParse(req.params)
    const header = req.headers.authorization
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
    return params.success && tokensMatch(bearer, pmTokenFor(options.token, params.data.pmId))
  }

  // Deny by default, keyed on the matched route pattern (not the raw URL, which can be percent-encoded).
  app.addHook('onRequest', async (req, reply) => {
    if (!isAllowedHost(req.headers.host, options.port, extraPorts)) {
      return reply.code(403).send({ success: false, error: 'Host no permitido' })
    }
    if (!isAllowedOrigin(req.headers.origin, allowedPorts)) {
      return reply.code(403).send({ success: false, error: 'Origen no permitido' })
    }
    const route = req.routeOptions.url
    if (route && PUBLIC_ROUTES.has(route)) return
    const isAuthorized =
      route === HOOK_ROUTE ? hasHookToken(req) : route === MCP_ROUTE ? hasPmToken(req) : hasCookieToken(req)
    if (!isAuthorized) return reply.code(401).send({ success: false, error: 'No autorizado' })
  })

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof SessionError) {
      return reply.code(400).send({ success: false, error: error.message })
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ success: false, error: 'Solicitud inválida' })
    }
    app.log.error(error)
    return reply.code(500).send({ success: false, error: 'Error interno' })
  })

  // Host + Origin checks make this safe against other websites; local processes are trusted.
  app.get('/api/session', async (_req, reply) => {
    reply.header('set-cookie', `${TOKEN_COOKIE}=${options.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`)
    return { success: true }
  })

  app.get('/api/terminals', async () => ({ success: true, data: service.list() }))

  app.post('/api/terminals', async (req, reply) => {
    const parsed = CreateTerminalSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' })
    }
    return { success: true, data: service.create(parsed.data) }
  })

  const scanSessions = options.scanSessions ?? (async () => [])

  app.get('/api/sessions/recent', async () => ({ success: true, data: await scanSessions() }))

  app.post('/api/terminals/import', async (req, reply) => {
    const parsed = ImportSessionsSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Selección inválida' })
    // The folder always comes from disk, never from the client.
    const found = new Map((await scanSessions()).map((s) => [s.sessionId, s]))
    const imported: TerminalDTO[] = []
    const errors: string[] = []
    for (const { sessionId, title } of parsed.data.sessions) {
      const session = found.get(sessionId)
      if (!session) {
        errors.push(`No encontré la sesión ${sessionId.slice(0, 8)} (¿ya importada o muy vieja?)`)
        continue
      }
      try {
        imported.push(service.importSession({ sessionId, cwd: session.cwd, title: title ?? session.title }))
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    return { success: true, data: { imported, errors } }
  })

  app.post('/api/terminals/:id/relaunch', async (req) => ({
    success: true,
    data: service.relaunch(parseId(req.params)),
  }))

  app.delete('/api/terminals/:id', async (req) => {
    const id = parseId(req.params)
    service.remove(id)
    broadcaster.terminalChanged({ type: 'terminal_removed', terminalId: id })
    return { success: true }
  })

  app.post('/api/pm', async (_req, reply) => {
    if (!options.openPm) return reply.code(404).send({ success: false, error: 'PM no disponible' })
    return { success: true, data: options.openPm() }
  })

  // Stateless Streamable HTTP: a fresh MCP server + transport per request.
  app.post(MCP_ROUTE, async (req, reply) => {
    const { pmId } = PmParams.parse(req.params)
    const pm = service.get(pmId)
    if (!options.createMcpServer || !pm || pm.role !== 'pm') {
      return reply.code(404).send({ success: false, error: 'PM no encontrado' })
    }
    const server = options.createMcpServer(pmId)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (error: unknown) {
      // The reply is hijacked: Fastify's error handler can no longer answer for us.
      app.log.error(error, 'MCP request failed')
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' })
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null }))
      } else {
        reply.raw.destroy()
      }
    }
  })
  app.get(MCP_ROUTE, async (_req, reply) => reply.code(405).send({ success: false, error: 'Usá POST' }))

  app.post(HOOK_ROUTE, async (req) => {
    const { terminalId } = TerminalIdParams.parse(req.params)
    const hook = parseHookPayload(req.body)
    if (hook) await service.handleHook(terminalId, hook)
    return { success: true }
  })

  await app.register(fastifyWebsocket, { options: { maxPayload: 128 * 1024 } })
  app.get('/ws', { websocket: true }, (socket) => {
    const subscriptions = new Map<string, () => void>()
    clients.add(socket)
    send(socket, { type: 'terminals', terminals: service.list() })

    const handle = (raw: unknown): void => {
      let json: unknown
      try {
        json = JSON.parse(String(raw))
      } catch {
        return
      }
      const parsed = ClientMessageSchema.safeParse(json)
      if (!parsed.success) return
      const msg = parsed.data
      switch (msg.type) {
        case 'attach': {
          subscriptions.get(msg.terminalId)?.()
          const unsubscribe = service.subscribe(msg.terminalId, {
            snapshot: (data) => send(socket, { type: 'snapshot', terminalId: msg.terminalId, data }),
            output: (data) => send(socket, { type: 'output', terminalId: msg.terminalId, data }),
          })
          subscriptions.set(msg.terminalId, unsubscribe)
          break
        }
        case 'detach':
          subscriptions.get(msg.terminalId)?.()
          subscriptions.delete(msg.terminalId)
          break
        case 'input':
          service.noteUserInput(msg.terminalId)
          service.write(msg.terminalId, msg.data)
          if (msg.data.includes('\r')) service.applyEvent(msg.terminalId, { kind: 'user_input' })
          break
        case 'resize':
          service.resize(msg.terminalId, msg.cols, msg.rows)
          break
      }
    }

    socket.on('message', (raw) => {
      try {
        handle(raw)
      } catch (error: unknown) {
        app.log.error(error, 'WebSocket message failed')
      }
    })
    socket.on('close', () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe()
      clients.delete(socket)
    })
  })

  if (existsSync(options.webDistDir)) {
    await app.register(fastifyStatic, { root: options.webDistDir, list: false })
  }

  return { app, service }
}
