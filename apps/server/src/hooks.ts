const HOOK_TIMEOUT_SECONDS = 5
const ASK_USER_TOOLS = 'ExitPlanMode|AskUserQuestion'

interface CommandHook {
  type: 'command'
  command: string
  timeout: number
}

interface HookMatcher {
  matcher?: string
  hooks: CommandHook[]
}

export interface HookSettings {
  hooks: Record<'UserPromptSubmit' | 'Stop' | 'Notification' | 'PreToolUse', HookMatcher[]>
}

export interface HookScriptPaths {
  nodeBin: string
  hookScript: string
}

/** Settings passed to each Claude process via --settings, so the user's own config is never touched. */
export function buildHookSettings({ nodeBin, hookScript }: HookScriptPaths): HookSettings {
  const command = (event: string): CommandHook => ({
    type: 'command',
    command: `"${nodeBin}" "${hookScript}" ${event}`,
    timeout: HOOK_TIMEOUT_SECONDS,
  })
  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [command('UserPromptSubmit')] }],
      Stop: [{ hooks: [command('Stop')] }],
      Notification: [{ hooks: [command('Notification')] }],
      PreToolUse: [{ matcher: ASK_USER_TOOLS, hooks: [command('PreToolUse')] }],
    },
  }
}

export type HookEventName = 'UserPromptSubmit' | 'Stop' | 'Notification' | 'AskUser'

export interface ParsedHook {
  event: HookEventName
  message: string | null
  transcriptPath: string | null
}

const TOOL_MESSAGES: Record<string, string> = {
  ExitPlanMode: 'Propone un plan y espera tu aprobación',
  AskUserQuestion: 'Te está haciendo una pregunta',
}

const IDLE_MESSAGE = /waiting for your input/i

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Normalizes a raw Claude Code hook payload. Returns null for events that should not change status. */
export function parseHookPayload(raw: unknown): ParsedHook | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, unknown>
  const name = str(payload.hook_event_name)
  const transcriptPath = str(payload.transcript_path)
  const message = str(payload.message)

  switch (name) {
    case 'UserPromptSubmit':
    case 'Stop':
      return { event: name, message: null, transcriptPath }
    case 'Notification': {
      // The 60s idle reminder after a finished turn is not a new request for attention.
      if (payload.notification_type === 'idle_prompt' || (message && IDLE_MESSAGE.test(message))) return null
      return { event: 'Notification', message, transcriptPath }
    }
    case 'PreToolUse': {
      const tool = str(payload.tool_name)
      const toolMessage = tool ? TOOL_MESSAGES[tool] : undefined
      return toolMessage ? { event: 'AskUser', message: toolMessage, transcriptPath } : null
    }
    default:
      return null
  }
}
