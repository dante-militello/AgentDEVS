import { z } from 'zod'

export const TERMINAL_STATUSES = [
  'starting',
  'idle',
  'working',
  'done',
  'needs_input',
  'exited',
  'unrestorable',
] as const

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

export type TerminalRole = 'manual' | 'pm' | 'worker'

export interface TerminalDTO {
  id: string
  sessionId: string
  title: string
  cwd: string
  missionId: string | null
  role: TerminalRole
  /** For workers: the PM terminal that created them. */
  parentId: string | null
  repoPath: string | null
  branch: string | null
  status: TerminalStatus
  isAlive: boolean
  lastSummary: string | null
  lastActivityAt: number
  createdAt: number
}

export const CreateTerminalSchema = z.object({
  title: z.string().trim().min(1).max(120),
  cwd: z.string().trim().min(1).max(500),
  missionId: z.uuid().nullable().optional(),
})
export type CreateTerminalInput = z.infer<typeof CreateTerminalSchema>

/** A Claude Code session found on disk that can be brought into AgentDEVS. */
export interface RecentSessionDTO {
  sessionId: string
  cwd: string
  title: string
  gitBranch: string | null
  lastActivityAt: number
  sizeBytes: number
}

export const ImportSessionsSchema = z.object({
  sessions: z
    .array(z.object({ sessionId: z.uuid(), title: z.string().trim().min(1).max(120).optional() }))
    .min(1)
    .max(50),
})
export type ImportSessionsInput = z.infer<typeof ImportSessionsSchema>

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('attach'), terminalId: z.uuid() }),
  z.object({ type: z.literal('detach'), terminalId: z.uuid() }),
  z.object({
    type: z.literal('input'),
    terminalId: z.uuid(),
    data: z.string().max(65_536),
  }),
  z.object({
    type: z.literal('resize'),
    terminalId: z.uuid(),
    cols: z.number().int().min(10).max(1000),
    rows: z.number().int().min(5).max(500),
  }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export type ServerMessage =
  | { type: 'terminals'; terminals: TerminalDTO[] }
  | { type: 'terminal'; terminal: TerminalDTO }
  | { type: 'terminal_removed'; terminalId: string }
  | { type: 'snapshot'; terminalId: string; data: string }
  | { type: 'output'; terminalId: string; data: string }
