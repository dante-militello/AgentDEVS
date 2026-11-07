import { describe, expect, test } from 'vitest'
import { buildChildEnv } from '../src/childEnv.js'

describe('buildChildEnv', () => {
  const parent = {
    PATH: 'C:\\bin',
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ID: 'abc',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
    CLAUDE_PID: '123',
    CLAUDE_EFFORT: 'medium',
    CLAUDE_CONFIG_DIR: 'C:\\cfg',
    ANTHROPIC_API_KEY: 'k',
    AGENTDEVS_HOOK_TOKEN: 'stale',
    UNDEFINED_VAR: undefined,
  }

  test('drops markers inherited from a parent Claude session (they disable transcripts)', () => {
    const env = buildChildEnv(parent, {})
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(env).not.toHaveProperty('CLAUDE_CODE_CHILD_SESSION')
    expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
    expect(env).not.toHaveProperty('CLAUDE_CODE_MESSAGING_TOKEN')
    expect(env).not.toHaveProperty('CLAUDE_PID')
    expect(env).not.toHaveProperty('CLAUDE_EFFORT')
  })

  test('keeps user configuration and normal variables', () => {
    const env = buildChildEnv(parent, {})
    expect(env).toMatchObject({ PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'C:\\cfg', ANTHROPIC_API_KEY: 'k' })
    expect(env).not.toHaveProperty('UNDEFINED_VAR')
  })

  test('per-terminal extras override stale AgentDEVS values', () => {
    const env = buildChildEnv(parent, { AGENTDEVS_HOOK_TOKEN: 'fresh' })
    expect(env.AGENTDEVS_HOOK_TOKEN).toBe('fresh')
  })

  test('does not mutate the parent env', () => {
    const copy = { ...parent }
    buildChildEnv(parent, { X: '1' })
    expect(parent).toEqual(copy)
  })
})
