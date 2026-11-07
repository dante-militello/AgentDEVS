import { join } from 'node:path'

export type LaunchMode = 'new' | 'resume'

export interface ClaudeLaunchOptions {
  sessionId: string
  mode: LaunchMode
  settingsPath?: string
  /** Role-specific flags (e.g. --mcp-config for the PM). Applied on every launch. */
  extraArgs?: readonly string[]
  /** First message for a brand-new session; never re-sent on resume. */
  initialPrompt?: string
}

export function buildClaudeArgs(options: ClaudeLaunchOptions): string[] {
  const sessionArgs =
    options.mode === 'new' ? ['--session-id', options.sessionId] : ['--resume', options.sessionId]
  const settingsArgs = options.settingsPath ? ['--settings', options.settingsPath] : []
  const extra = options.extraArgs ?? []
  // "--" stops option parsing, so a prompt starting with "-" can never be read as a flag.
  const prompt = options.mode === 'new' && options.initialPrompt ? ['--', options.initialPrompt] : []
  return [...sessionArgs, ...settingsArgs, ...extra, ...prompt]
}

/** Mirrors how Claude Code names per-project folders under ~/.claude/projects. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function sessionTranscriptPath(claudeHome: string, cwd: string, sessionId: string): string {
  return join(claudeHome, 'projects', encodeProjectDir(cwd), `${sessionId}.jsonl`)
}
