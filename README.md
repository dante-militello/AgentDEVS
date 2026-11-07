# AgentDEVS

Local web PM for Claude Code sessions: persistent terminals that come back after a reboot, status at a glance, and (next phases) missions, diagram, worktrees and Obsidian memory.

## Run

```bash
npm install
npm run build        # builds the web UI into apps/web/dist
npm start            # http://localhost:4317 (server serves the UI)
```

Development (two terminals, hot reload):

```bash
npm run dev:server   # :4317
npm run dev:web      # :5173, proxies /api and /ws to :4317
```

## Config (env vars)

| Var | Default |
|---|---|
| `AGENTDEVS_PORT` | `4317` |
| `AGENTDEVS_DATA_DIR` | `./data` (SQLite + auth token) |
| `AGENTDEVS_CLAUDE_BIN` | `claude.exe` |

## How restore works

Each terminal is launched with `claude --session-id <uuid>`. On server start, every terminal that was not closed by you is relaunched with `claude --resume <uuid>` in the same folder, so the conversation comes back with full context.

## Security

Binds to `127.0.0.1` only, validates `Host`/`Origin` (DNS-rebinding and cross-site protection) and requires an httpOnly `SameSite=Strict` token cookie for the API and WebSocket.
