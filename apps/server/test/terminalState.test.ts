import { describe, expect, test } from 'vitest'
import { nextStatus } from '../src/terminalState.js'

describe('nextStatus', () => {
  test('a spawned process becomes idle', () => {
    expect(nextStatus('starting', { kind: 'spawned' })).toBe('idle')
  })

  test('process exit always wins', () => {
    expect(nextStatus('working', { kind: 'exited' })).toBe('exited')
    expect(nextStatus('needs_input', { kind: 'exited' })).toBe('exited')
  })

  test('user input on a done/needs_input terminal moves it back to idle', () => {
    expect(nextStatus('done', { kind: 'user_input' })).toBe('idle')
    expect(nextStatus('needs_input', { kind: 'user_input' })).toBe('idle')
    expect(nextStatus('working', { kind: 'user_input' })).toBe('working')
  })

  test('hook events map to statuses', () => {
    expect(nextStatus('idle', { kind: 'hook', event: 'UserPromptSubmit' })).toBe('working')
    expect(nextStatus('working', { kind: 'hook', event: 'Stop' })).toBe('done')
    expect(nextStatus('working', { kind: 'hook', event: 'Notification' })).toBe('needs_input')
    expect(nextStatus('working', { kind: 'hook', event: 'AskUser' })).toBe('needs_input')
  })

  test('unknown hook events keep current status', () => {
    expect(nextStatus('working', { kind: 'hook', event: 'Other' })).toBe('working')
  })

  test('an exited terminal ignores everything but a respawn', () => {
    expect(nextStatus('exited', { kind: 'hook', event: 'Stop' })).toBe('exited')
    expect(nextStatus('exited', { kind: 'spawned' })).toBe('idle')
  })
})
