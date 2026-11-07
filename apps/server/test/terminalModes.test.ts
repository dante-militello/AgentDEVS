import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { trackPrivateModes } from '../src/terminalModes.js'

const require = createRequire(import.meta.url)
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless')

function write(term: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('trackPrivateModes', () => {
  test('replays SGR mouse encoding, which the serialize addon drops', async () => {
    const term = new Terminal({ allowProposedApi: true })
    const modes = trackPrivateModes(term)
    await write(term, '\x1b[?1049h\x1b[?1003h\x1b[?1006h')
    expect(modes.toSequence()).toContain('\x1b[?1006h')
  })

  test('handles several params in one sequence and later resets', async () => {
    const term = new Terminal({ allowProposedApi: true })
    const modes = trackPrivateModes(term)
    await write(term, '\x1b[?1000;1006h')
    expect(modes.toSequence()).toContain('\x1b[?1006h')
    await write(term, '\x1b[?1006l')
    expect(modes.toSequence()).not.toContain('1006')
  })

  test('replays a hidden cursor', async () => {
    const term = new Terminal({ allowProposedApi: true })
    const modes = trackPrivateModes(term)
    await write(term, '\x1b[?25l')
    expect(modes.toSequence()).toContain('\x1b[?25l')
    await write(term, '\x1b[?25h')
    expect(modes.toSequence()).toBe('')
  })

  test('does not break normal parsing (modes still apply to the mirror)', async () => {
    const term = new Terminal({ allowProposedApi: true })
    trackPrivateModes(term)
    await write(term, '\x1b[?1003h')
    expect(term.modes.mouseTrackingMode).toBe('any')
  })
})
