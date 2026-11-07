import { describe, expect, test } from 'vitest'
import { buildClaudeArgs, encodeProjectDir, sessionTranscriptPath } from '../src/claudeCommand.js'

describe('buildClaudeArgs', () => {
  test('starts a new session with a fixed session id', () => {
    const args = buildClaudeArgs({ sessionId: 'abc', mode: 'new' })
    expect(args).toEqual(['--session-id', 'abc'])
  })

  test('resumes an existing session by id', () => {
    const args = buildClaudeArgs({ sessionId: 'abc', mode: 'resume' })
    expect(args).toEqual(['--resume', 'abc'])
  })

  test('appends settings file when provided', () => {
    const args = buildClaudeArgs({ sessionId: 'abc', mode: 'new', settingsPath: 'C:\\s.json' })
    expect(args).toEqual(['--session-id', 'abc', '--settings', 'C:\\s.json'])
  })
})

describe('encodeProjectDir', () => {
  test('encodes a windows path like Claude Code does', () => {
    expect(encodeProjectDir('E:\\Proyectos\\AgentDEVS')).toBe('E--Proyectos-AgentDEVS')
  })

  test('replaces every non alphanumeric character with a dash', () => {
    expect(encodeProjectDir('C:\\Users\\usuario\\My Proj.v2')).toBe('C--Users-usuario-My-Proj-v2')
  })
})

describe('sessionTranscriptPath', () => {
  test('points to the jsonl inside the encoded project folder', () => {
    const p = sessionTranscriptPath('C:\\Users\\me\\.claude', 'E:\\Proyectos\\X', 'id-1')
    expect(p.replaceAll('\\', '/')).toBe('C:/Users/me/.claude/projects/E--Proyectos-X/id-1.jsonl')
  })
})

describe('buildClaudeArgs extras', () => {
  test('adds extra flags and an initial prompt only for new sessions', () => {
    const args = buildClaudeArgs({
      sessionId: 'abc',
      mode: 'new',
      extraArgs: ['--mcp-config', 'C:\\m.json'],
      initialPrompt: 'Hacé la tarea',
    })
    expect(args).toEqual(['--session-id', 'abc', '--mcp-config', 'C:\\m.json', '--', 'Hacé la tarea'])
  })

  test('never re-sends the initial prompt when resuming', () => {
    const args = buildClaudeArgs({ sessionId: 'abc', mode: 'resume', initialPrompt: 'Hacé la tarea' })
    expect(args).toEqual(['--resume', 'abc'])
  })
})
