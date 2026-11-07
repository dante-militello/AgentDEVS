import type { TerminalStatus } from '@agentdevs/shared'

export type TerminalEvent =
  | { kind: 'spawned' }
  | { kind: 'exited' }
  | { kind: 'user_input' }
  | { kind: 'hook'; event: string }

const HOOK_STATUS: Record<string, TerminalStatus> = {
  UserPromptSubmit: 'working',
  Stop: 'done',
  Notification: 'needs_input',
  AskUser: 'needs_input',
}

export function nextStatus(current: TerminalStatus, event: TerminalEvent): TerminalStatus {
  if (event.kind === 'spawned') return 'idle'
  if (event.kind === 'exited') return 'exited'
  if (current === 'exited' || current === 'unrestorable') return current
  if (event.kind === 'user_input') {
    return current === 'done' || current === 'needs_input' ? 'idle' : current
  }
  return HOOK_STATUS[event.event] ?? current
}
