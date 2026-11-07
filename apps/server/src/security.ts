import { createHmac, timingSafeEqual } from 'node:crypto'

/** The PM's MCP token only works on its own /mcp/<pmId> endpoint. */
export function pmTokenFor(masterToken: string, pmId: string): string {
  return createHmac('sha256', masterToken).update(`pm:${pmId}`).digest('hex')
}

/** Each Claude process only gets a token that lets it report about itself. */
export function hookTokenFor(masterToken: string, terminalId: string): string {
  return createHmac('sha256', masterToken).update(`hook:${terminalId}`).digest('hex')
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function splitHost(host: string): { hostname: string; port: number | null } {
  const idx = host.lastIndexOf(':')
  if (idx <= 0 || host.endsWith(']')) return { hostname: host, port: null }
  const port = Number(host.slice(idx + 1))
  return { hostname: host.slice(0, idx), port: Number.isInteger(port) ? port : null }
}

/** Guards against DNS rebinding: only loopback host headers on known ports pass. */
export function isAllowedHost(
  host: string | undefined,
  serverPort: number,
  extraPorts: readonly number[] = [],
): boolean {
  if (!host) return false
  const { hostname, port } = splitHost(host.toLowerCase())
  if (!LOCAL_HOSTNAMES.has(hostname)) return false
  return port !== null && [serverPort, ...extraPorts].includes(port)
}

/** Browsers send Origin on cross-site requests; reject anything that is not our own UI. */
export function isAllowedOrigin(origin: string | undefined, allowedPorts: readonly number[]): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return false
    if (!LOCAL_HOSTNAMES.has(url.hostname === '::1' ? '[::1]' : url.hostname)) return false
    return allowedPorts.includes(Number(url.port))
  } catch {
    return false
  }
}

export function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
