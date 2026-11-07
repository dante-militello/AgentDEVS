import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from './app.js'
import { loadConfig, type AppConfig } from './config.js'
import { openDatabase } from './db.js'
import { buildHookSettings } from './hooks.js'
import { createWindowsNotifier } from './notifier.js'
import { createPtyHost } from './ptyHost.js'
import { hookTokenFor } from './security.js'
import { createSessionService, type LaunchExtras } from './sessionService.js'
import { createTerminalRepo, type TerminalRecord } from './terminalRepo.js'
import { readLastAssistantText } from './transcript.js'
import { scanRecentSessions } from './sessionScanner.js'
import { createPmRelay } from './pmRelay.js'
import { openPm, writePmMcpConfig, writePmSettings, type PmPaths } from './pmSetup.js'
import { createPmMcpServer } from './pmTools.js'
import { createWorktree, findRepoRoot } from './worktrees.js'
import { createTrustGate, isPathTrusted, readTrustedProjects } from './trustGate.js'
import { homedir } from 'node:os'
import type { SessionService } from './sessionService.js'

const RECENT_SESSIONS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Shared settings files; each terminal is identified by its env vars. */
function writeSettings(config: AppConfig): { workerSettings: string; pm: PmPaths } {
  const hookSettings = buildHookSettings({ nodeBin: config.nodeBin, hookScript: config.hookScript })
  const workerSettings = join(config.dataDir, 'hook-settings.json')
  writeFileSync(workerSettings, JSON.stringify(hookSettings, null, 2))
  const pmDir = join(config.rootDir, 'pm')
  return {
    workerSettings,
    pm: { settingsPath: writePmSettings(config.dataDir, hookSettings), rulesPath: join(pmDir, 'PM.md'), pmDir },
  }
}

function launchExtrasFor(config: AppConfig, workerSettings: string, pm: PmPaths) {
  return (record: TerminalRecord): LaunchExtras => {
    const env = {
      AGENTDEVS_TERMINAL_ID: record.id,
      AGENTDEVS_HOOK_URL: `http://127.0.0.1:${config.port}/hooks/${record.id}`,
      AGENTDEVS_HOOK_TOKEN: hookTokenFor(config.token, record.id),
    }
    if (record.role !== 'pm') return { settingsPath: workerSettings, env }
    return {
      settingsPath: pm.settingsPath,
      env,
      extraArgs: [
        '--mcp-config',
        writePmMcpConfig(config.dataDir, config.port, config.token, record.id),
        '--append-system-prompt-file',
        pm.rulesPath,
      ],
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const db = openDatabase(join(config.dataDir, 'agentdevs.db'))
  const repo = createTerminalRepo(db)
  const { workerSettings, pm } = writeSettings(config)
  // The relay and MCP tools need the service, which is created inside buildApp.
  let serviceRef: SessionService | null = null
  const requireService = (): SessionService => {
    if (!serviceRef) throw new Error('Session service not ready')
    return serviceRef
  }
  const claudeJsonPath = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')
  const trustGate = createTrustGate({
    getTerminal: (id) => requireService().get(id),
    isRepoTrusted: async (repoPath) => isPathTrusted(await readTrustedProjects(claudeJsonPath), repoPath),
    write: (id, data) => requireService().write(id, data),
    needsUser: (id, reason) => requireService().applyEvent(id, { kind: 'hook', event: 'Notification' }, reason),
  })
  const relay = createPmRelay({
    getTerminal: (id) => requireService().get(id),
    submit: (id, text) => requireService().submit(id, text),
    isUserActive: (id) => requireService().isUserActive(id),
    getPmId: () => requireService().list().find((t) => t.role === 'pm' && t.isAlive)?.id ?? null,
  })

  // The Claude session that launched this server (if any) is live elsewhere: never offer it for import.
  const parentSessionId = process.env.CLAUDE_CODE_SESSION_ID
  const scanSessions = () =>
    scanRecentSessions({
      claudeHome: config.claudeHome,
      maxAgeMs: RECENT_SESSIONS_MAX_AGE_MS,
      excludeIds: new Set([...repo.allSessionIds(), ...(parentSessionId ? [parentSessionId] : [])]),
    })

  const { app, service } = await buildApp(
    {
      port: config.port,
      devWebPort: config.devWebPort,
      token: config.token,
      webDistDir: config.webDistDir,
      logger: true,
      scanSessions,
      openPm: () => openPm(requireService(), pm.pmDir),
      createMcpServer: (pmId) =>
        createPmMcpServer(pmId, {
          service: requireService(),
          claudeHome: config.claudeHome,
          findRepoRoot,
          createWorktree,
          readLastAssistantText,
          isRepoAllowed: async (repoRoot) => isPathTrusted(await readTrustedProjects(claudeJsonPath), repoRoot),
        }),
    },
    (broadcaster) => {
      const logError = (message: string, error: unknown) => app.log.error({ err: error }, message)
      const notifier = createWindowsNotifier(`http://localhost:${config.port}`, logError)
      return createSessionService({
        repo,
        createHost: createPtyHost,
        claudeBin: config.claudeBin,
        claudeHome: config.claudeHome,
        isDirectory,
        fileExists: existsSync,
        onTerminalChanged: (terminal) => broadcaster.terminalChanged({ type: 'terminal', terminal }),
        onTransition: (previous, terminal) => {
          notifier.notifyTransition(previous, terminal)
          relay.onTransition(previous, terminal)
        },
        launchExtras: launchExtrasFor(config, workerSettings, pm),
        onOutput: (id, data) => trustGate.onOutput(id, data),
        onLaunched: (record) => {
          if (record.role !== 'manual') trustGate.watch(record.id)
        },
        readSummary: readLastAssistantText,
        logError,
      })
    },
  )

  serviceRef = service

  let isClosing = false
  const shutdown = async (): Promise<void> => {
    if (isClosing) return
    isClosing = true
    service.shutdown()
    await app.close()
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await app.listen({ host: '127.0.0.1', port: config.port })
  service.restoreAll()
}

main().catch((error: unknown) => {
  process.stderr.write(`AgentDEVS failed to start: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
