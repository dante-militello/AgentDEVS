#!/usr/bin/env node
// Called by Claude Code hooks (configured per terminal via --settings).
// Forwards the hook payload to the local AgentDEVS server. Must be fast and never block Claude:
// it always exits 0 and prints nothing, whatever happens.

const TIMEOUT_MS = 2000
const MAX_STDIN_BYTES = 1024 * 1024

const url = process.env.AGENTDEVS_HOOK_URL
const token = process.env.AGENTDEVS_HOOK_TOKEN

async function readStdin() {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > MAX_STDIN_BYTES) break
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  if (!url || !token) return
  const body = await readStdin()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentdevs-hook-token': token },
      body: body || '{}',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0))
