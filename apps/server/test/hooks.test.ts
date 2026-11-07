import { describe, expect, test } from 'vitest'
import { buildHookSettings, parseHookPayload } from '../src/hooks.js'
import { extractLastAssistantText } from '../src/transcript.js'
import { shouldNotify } from '../src/notifier.js'

describe('buildHookSettings', () => {
  const settings = buildHookSettings({ nodeBin: 'C:\\node.exe', hookScript: 'E:\\a\\hook.mjs' })

  test('registers the events that drive terminal status', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(['Notification', 'PreToolUse', 'Stop', 'UserPromptSubmit'])
  })

  test('PreToolUse only fires for plan approval and questions', () => {
    expect(settings.hooks.PreToolUse[0]?.matcher).toBe('ExitPlanMode|AskUserQuestion')
  })

  test('commands quote paths and pass the event name', () => {
    const cmd = settings.hooks.Stop[0]?.hooks[0]
    expect(cmd).toMatchObject({ type: 'command', command: '"C:\\node.exe" "E:\\a\\hook.mjs" Stop' })
    expect(cmd?.timeout).toBeLessThanOrEqual(10)
  })
})

describe('parseHookPayload', () => {
  test('maps prompt submit and stop', () => {
    expect(parseHookPayload({ hook_event_name: 'UserPromptSubmit' })?.event).toBe('UserPromptSubmit')
    expect(parseHookPayload({ hook_event_name: 'Stop', transcript_path: 'x.jsonl' })).toMatchObject({
      event: 'Stop',
      transcriptPath: 'x.jsonl',
    })
  })

  test('permission notifications mean the user is needed', () => {
    const p = parseHookPayload({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' })
    expect(p).toMatchObject({ event: 'Notification', message: 'Claude needs your permission to use Bash' })
  })

  test('idle reminders after a finished turn are ignored', () => {
    expect(parseHookPayload({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })).toBeNull()
    expect(parseHookPayload({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' })).toBeNull()
  })

  test('plan approval and questions become AskUser', () => {
    expect(parseHookPayload({ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode' })).toMatchObject({
      event: 'AskUser',
      message: 'Propone un plan y espera tu aprobación',
    })
    expect(parseHookPayload({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })?.event).toBe('AskUser')
  })

  test('other tools and garbage are ignored', () => {
    expect(parseHookPayload({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toBeNull()
    expect(parseHookPayload(null)).toBeNull()
    expect(parseHookPayload({ hook_event_name: 42 })).toBeNull()
  })
})

describe('extractLastAssistantText', () => {
  const line = (o: unknown) => JSON.stringify(o)

  test('returns the last assistant text block, trimmed and capped', () => {
    const jsonl = [
      line({ type: 'user', message: { role: 'user', content: 'hola' } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'primero' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: '  Listo:   arreglé el bug\n\ny agregué tests  ' }] } }),
      '',
    ].join('\n')
    expect(extractLastAssistantText(jsonl, 280)).toBe('Listo: arreglé el bug y agregué tests')
  })

  test('caps long text with an ellipsis', () => {
    const jsonl = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'a'.repeat(50) }] } })
    expect(extractLastAssistantText(jsonl, 10)).toBe('aaaaaaaaa…')
  })

  test('survives a truncated first line and returns null when nothing matches', () => {
    expect(extractLastAssistantText('{"broken\n' + line({ type: 'user' }), 100)).toBeNull()
  })
})

describe('shouldNotify', () => {
  test('notifies when a terminal finishes or needs the user', () => {
    expect(shouldNotify('working', 'done')).toBe(true)
    expect(shouldNotify('working', 'needs_input')).toBe(true)
    expect(shouldNotify('idle', 'needs_input')).toBe(true)
  })

  test('does not repeat for the same state or for other transitions', () => {
    expect(shouldNotify('done', 'done')).toBe(false)
    expect(shouldNotify('idle', 'working')).toBe(false)
    expect(shouldNotify('working', 'exited')).toBe(false)
  })
})
