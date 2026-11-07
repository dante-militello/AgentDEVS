import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalDTO } from '@agentdevs/shared'
import type { HookSettings } from './hooks.js'
import { pmTokenFor } from './security.js'
import type { SessionService } from './sessionService.js'

/**
 * Read-only tools run without prompts. Creating workers and messaging them still ask the user,
 * which is the human approval step for the plan and for every instruction.
 */
const PM_AUTO_ALLOWED_TOOLS = ['mcp__agentdevs__listar_workers', 'mcp__agentdevs__leer_reporte']

export interface PmPaths {
  settingsPath: string
  rulesPath: string
  pmDir: string
}

export function writePmSettings(dataDir: string, hookSettings: HookSettings): string {
  const path = join(dataDir, 'pm-settings.json')
  writeFileSync(path, JSON.stringify({ ...hookSettings, permissions: { allow: PM_AUTO_ALLOWED_TOOLS } }, null, 2))
  return path
}

/** Per-PM MCP config: the URL and token only work for this PM terminal. */
export function writePmMcpConfig(dataDir: string, port: number, masterToken: string, pmId: string): string {
  const path = join(dataDir, `pm-mcp-${pmId}.json`)
  const config = {
    mcpServers: {
      agentdevs: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp/${pmId}`,
        headers: { Authorization: `Bearer ${pmTokenFor(masterToken, pmId)}` },
      },
    },
  }
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
  return path
}

/** There is a single PM: reuse it (relaunching if closed) or create it. */
export function openPm(service: SessionService, pmDir: string): TerminalDTO {
  const existing = service.list().find((t) => t.role === 'pm')
  if (existing) return existing.isAlive ? existing : service.relaunch(existing.id)
  return service.create({ title: 'PM', cwd: pmDir, role: 'pm' })
}
