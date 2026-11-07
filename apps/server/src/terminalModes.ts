import type { Terminal } from '@xterm/headless'

/**
 * Private modes that @xterm/addon-serialize does not include in its output but that full-screen
 * apps like Claude Code rely on. Without 1006 the browser sends mouse/wheel events in the legacy
 * X10 encoding, which Claude misreads as keystrokes: no scrolling and constant redraws.
 */
const MOUSE_ENCODINGS = [1005, 1006, 1015] as const
const CURSOR_VISIBLE = 25

export interface ModeTracker {
  /** Escape sequences to append after a serialized snapshot. */
  toSequence(): string
}

function numbers(params: (number | number[])[]): number[] {
  return params.filter((p): p is number => typeof p === 'number')
}

export function trackPrivateModes(term: Terminal): ModeTracker {
  const mouseEncodings = new Set<number>()
  let isCursorHidden = false

  const apply = (params: (number | number[])[], isSet: boolean): boolean => {
    for (const mode of numbers(params)) {
      if ((MOUSE_ENCODINGS as readonly number[]).includes(mode)) {
        if (isSet) mouseEncodings.add(mode)
        else mouseEncodings.delete(mode)
      } else if (mode === CURSOR_VISIBLE) {
        isCursorHidden = !isSet
      }
    }
    return false // Observe only: let xterm apply the mode as usual.
  }

  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => apply(params, true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => apply(params, false))

  return {
    toSequence() {
      const mouse = [...mouseEncodings].map((m) => `\x1b[?${m}h`).join('')
      return mouse + (isCursorHidden ? `\x1b[?${CURSOR_VISIBLE}l` : '')
    },
  }
}
