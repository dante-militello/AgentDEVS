import type { CreateTerminalInput, ImportSessionsInput, RecentSessionDTO, TerminalDTO } from '@agentdevs/shared'

export interface ImportResult {
  imported: TerminalDTO[]
  errors: string[]
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json()) as ApiResponse<T>
  if (!res.ok || !json.success) throw new Error(json.error ?? `Error ${res.status}`)
  return json.data as T
}

export const api = {
  ensureSession: () => request<void>('GET', '/api/session'),
  createTerminal: (input: CreateTerminalInput) => request<TerminalDTO>('POST', '/api/terminals', input),
  relaunchTerminal: (id: string) => request<TerminalDTO>('POST', `/api/terminals/${id}/relaunch`),
  removeTerminal: (id: string) => request<void>('DELETE', `/api/terminals/${id}`),
  openPm: () => request<TerminalDTO>('POST', '/api/pm'),
  recentSessions: () => request<RecentSessionDTO[]>('GET', '/api/sessions/recent'),
  importSessions: (input: ImportSessionsInput) => request<ImportResult>('POST', '/api/terminals/import', input),
}
