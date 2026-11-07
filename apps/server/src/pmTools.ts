import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { TerminalDTO } from '@agentdevs/shared'
import { sessionTranscriptPath } from './claudeCommand.js'
import { sanitizeForPrompt } from './pmRelay.js'
import type { SessionService } from './sessionService.js'
import { buildWorkerBrief } from './workerBrief.js'
import type { Worktree } from './worktrees.js'

export const MAX_ACTIVE_WORKERS = 4
const REPORT_MAX_CHARS = 4000
const MESSAGE_MAX_CHARS = 2000

export interface PmToolsDeps {
  service: SessionService
  claudeHome: string
  findRepoRoot: (path: string) => Promise<string | null>
  createWorktree: (options: { repoRoot: string; name: string }) => Promise<Worktree>
  readLastAssistantText: (path: string, maxChars: number) => Promise<string | null>
  /** Only repos the user already trusts in Claude Code may get workers (git runs repo hooks/config). */
  isRepoAllowed: (repoRoot: string) => Promise<boolean>
}

/** Serializes calls so concurrent crear_worker requests cannot both pass the worker cap. */
function createMutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

const createWorkerLock = createMutex()

interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true })

function describeWorker(t: TerminalDTO) {
  return {
    id: t.id,
    titulo: t.title,
    /** worker = creado por el PM; manual = abierta o importada por el usuario. */
    tipo: t.role,
    estado: t.status,
    vivo: t.isAlive,
    repo: t.repoPath,
    rama: t.branch,
    worktree: t.cwd,
    resumen: t.lastSummary,
  }
}

/** Builds the MCP server the PM session talks to. One instance per request (stateless transport). */
export function createPmMcpServer(pmId: string, deps: PmToolsDeps): McpServer {
  const { service } = deps
  const server = new McpServer({ name: 'agentdevs', version: '0.1.0' })

  /** Everything the PM supervises: its own workers plus the terminals the user opened or imported. */
  const workersOf = (): TerminalDTO[] =>
    service.list().filter((t) => t.id !== pmId && t.role !== 'pm' && (t.role === 'manual' || t.parentId === pmId))
  const ownCreatedWorkers = (): TerminalDTO[] => workersOf().filter((t) => t.role === 'worker')
  /** Accepts a full ID or an unambiguous prefix (the relay shows the first 8 chars). */
  const ownWorker = (id: string): TerminalDTO | null => {
    const matches = workersOf().filter((w) => w.id === id || w.id.startsWith(id))
    return matches.length === 1 ? (matches[0] ?? null) : null
  }

  server.registerTool(
    'listar_workers',
    {
      title: 'Listar workers',
      description:
        'Lista todas las terminales que supervisás: tus workers (tipo worker) y las que abrió o importó el usuario ' +
        '(tipo manual), con estado (idle, working, done, needs_input, exited), carpeta, rama y último resumen.',
      inputSchema: {},
    },
    async () => ok(workersOf().map(describeWorker)),
  )

  server.registerTool(
    'crear_worker',
    {
      title: 'Crear worker',
      description:
        'Crea un worker: una sesión de Claude Code nueva en su propia git worktree y rama (agentdevs/<nombre>), ' +
        'y le manda la tarea como primer mensaje. Usalo solo después de que el usuario aprobó el plan. ' +
        `Máximo ${MAX_ACTIVE_WORKERS} workers activos a la vez.`,
      inputSchema: {
        repo: z.string().min(1).describe('Ruta absoluta del repo git, ej: E:\\Proyectos\\miproyecto'),
        titulo: z.string().min(1).max(80).describe('Nombre corto de la tarea (se usa para la rama)'),
        tarea: z.string().min(10).max(8000).describe('Qué tiene que hacer, con criterios de terminado'),
        alcance: z.string().max(1000).optional().describe('Carpetas/archivos que puede tocar, para no pisarse con otros workers'),
      },
    },
    async ({ repo, titulo, tarea, alcance }) =>
      createWorkerLock(async () => {
      const active = ownCreatedWorkers().filter((w) => w.isAlive)
      if (active.length >= MAX_ACTIVE_WORKERS) {
        return fail(`Ya hay ${active.length} workers activos (máximo ${MAX_ACTIVE_WORKERS}). Esperá a que termine alguno.`)
      }
      const repoRoot = await deps.findRepoRoot(repo)
      if (!repoRoot) return fail(`"${repo}" no es un repo git.`)
      if (!(await deps.isRepoAllowed(repoRoot))) {
        return fail(`Todavía no confiaste en ${repoRoot} en Claude Code. Pedile al usuario que abra Claude ahí una vez y acepte la carpeta.`)
      }
      try {
        const worktree = await deps.createWorktree({ repoRoot, name: titulo })
        const worker = service.create({
          title: titulo,
          cwd: worktree.path,
          role: 'worker',
          parentId: pmId,
          repoPath: repoRoot,
          branch: worktree.branch,
          initialPrompt: buildWorkerBrief({ title: titulo, task: tarea, scope: alcance, branch: worktree.branch, repoPath: repoRoot }),
        })
        return ok({ creado: describeWorker(worker) })
      } catch (error: unknown) {
        return fail(`No pude crear el worker: ${error instanceof Error ? error.message : String(error)}`)
      }
      }),
  )

  server.registerTool(
    'leer_reporte',
    {
      title: 'Leer reporte',
      description: 'Devuelve el estado y la última respuesta completa de un worker (su reporte, pregunta o plan).',
      inputSchema: { worker_id: z.string().min(4).describe('ID del worker (alcanza con los primeros 8 caracteres)') },
    },
    async ({ worker_id }) => {
      const worker = ownWorker(worker_id)
      if (!worker) return fail('No encontré ese worker entre los tuyos.')
      const transcript = sessionTranscriptPath(deps.claudeHome, worker.cwd, worker.sessionId)
      const ultimaRespuesta = await deps.readLastAssistantText(transcript, REPORT_MAX_CHARS).catch(() => null)
      return ok({ ...describeWorker(worker), ultima_respuesta: ultimaRespuesta })
    },
  )

  server.registerTool(
    'mandar_mensaje',
    {
      title: 'Mandar mensaje a un worker',
      description:
        'Escribe un mensaje en la terminal de un worker y lo envía, como si fuera el usuario. ' +
        'Solo funciona si el worker terminó o está libre (estado idle o done). Si pide algo (needs_input), avisale al usuario.',
      inputSchema: {
        worker_id: z.string().min(4),
        mensaje: z.string().min(1).max(MESSAGE_MAX_CHARS),
      },
    },
    async ({ worker_id, mensaje }) => {
      const worker = ownWorker(worker_id)
      if (!worker) return fail('No encontré ese worker entre los tuyos.')
      if (!worker.isAlive) return fail('Ese worker está cerrado.')
      if (worker.status === 'working' || worker.status === 'starting') {
        return fail('El worker está trabajando; esperá a que termine.')
      }
      // needs_input is often a permission dialog: typing + Enter would approve it on the user's behalf.
      if (worker.status === 'needs_input') {
        return fail('El worker está esperando una respuesta del usuario (puede ser un permiso). Avisale al usuario que entre a esa terminal.')
      }
      service.submit(worker.id, sanitizeForPrompt(mensaje, MESSAGE_MAX_CHARS))
      return ok({ enviado: true, worker: worker.title })
    },
  )

  return server
}
