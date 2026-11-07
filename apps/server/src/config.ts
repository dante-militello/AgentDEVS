import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_PORT = 4317
const DEV_WEB_PORT = 5173

export interface AppConfig {
  rootDir: string
  dataDir: string
  port: number
  /** Vite dev server port, trusted only when started with --dev. */
  devWebPort: number | undefined
  hookScript: string
  nodeBin: string
  token: string
  claudeBin: string
  claudeHome: string
  webDistDir: string
}

function loadOrCreateToken(dataDir: string): string {
  const tokenPath = join(dataDir, 'token')
  if (existsSync(tokenPath)) return readFileSync(tokenPath, 'utf8').trim()
  const token = randomBytes(32).toString('hex')
  writeFileSync(tokenPath, token, { mode: 0o600 })
  return token
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${raw}`)
  }
  return port
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.AGENTDEVS_DATA_DIR ?? join(ROOT_DIR, 'data')
  mkdirSync(dataDir, { recursive: true })
  return {
    rootDir: ROOT_DIR,
    dataDir,
    port: parsePort(process.env.AGENTDEVS_PORT, DEFAULT_PORT),
    devWebPort: process.argv.includes('--dev') ? DEV_WEB_PORT : undefined,
    hookScript: join(ROOT_DIR, 'hooks', 'agentdevs-hook.mjs'),
    nodeBin: process.execPath,
    token: loadOrCreateToken(dataDir),
    claudeBin: process.env.AGENTDEVS_CLAUDE_BIN ?? (process.platform === 'win32' ? 'claude.exe' : 'claude'),
    claudeHome: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    webDistDir: join(ROOT_DIR, 'apps', 'web', 'dist'),
  }
}
