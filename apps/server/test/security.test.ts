import { describe, expect, test } from 'vitest'
import { isAllowedHost, isAllowedOrigin, tokensMatch } from '../src/security.js'

describe('isAllowedHost', () => {
  test('accepts localhost and loopback with the right port', () => {
    expect(isAllowedHost('localhost:4317', 4317)).toBe(true)
    expect(isAllowedHost('127.0.0.1:4317', 4317)).toBe(true)
  })

  test('rejects foreign hosts (DNS rebinding)', () => {
    expect(isAllowedHost('evil.com:4317', 4317)).toBe(false)
    expect(isAllowedHost(undefined, 4317)).toBe(false)
  })

  test('accepts the dev web port too when listed', () => {
    expect(isAllowedHost('localhost:5173', 4317, [5173])).toBe(true)
  })
})

describe('isAllowedOrigin', () => {
  test('allows missing origin (same-origin navigation, CLI hooks)', () => {
    expect(isAllowedOrigin(undefined, [4317])).toBe(true)
  })

  test('allows local origins on known ports', () => {
    expect(isAllowedOrigin('http://localhost:5173', [4317, 5173])).toBe(true)
  })

  test('rejects other sites', () => {
    expect(isAllowedOrigin('https://evil.com', [4317])).toBe(false)
    expect(isAllowedOrigin('http://localhost:9999', [4317])).toBe(false)
  })
})

describe('tokensMatch', () => {
  test('compares in constant time and handles length mismatch', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true)
    expect(tokensMatch('abc', 'abd')).toBe(false)
    expect(tokensMatch('abc', 'abcd')).toBe(false)
    expect(tokensMatch(undefined, 'abc')).toBe(false)
  })
})
