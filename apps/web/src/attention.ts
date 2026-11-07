import type { TerminalDTO, TerminalStatus } from '@agentdevs/shared'

const ACK_STORAGE_KEY = 'agentdevs.acks'

export type Acks = Record<string, number>

export function loadAcks(): Acks {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Acks) : {}
  } catch {
    return {}
  }
}

export function saveAcks(acks: Acks): void {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(acks))
  } catch {
    // Storage full or disabled: acks just won't survive a reload.
  }
}

/** A terminal wants you if it is asking something, or finished and you have not looked yet. */
export function needsAttention(terminal: TerminalDTO, acks: Acks): boolean {
  if (terminal.status === 'needs_input') return true
  return terminal.status === 'done' && acks[terminal.id] !== terminal.lastActivityAt
}

export function isAttentionTransition(previous: TerminalStatus | undefined, next: TerminalStatus): boolean {
  return previous !== next && (next === 'done' || next === 'needs_input')
}

let audio: AudioContext | null = null

/** Short synthesized chime: two rising notes when it needs you, one soft note when it finished. */
export function playChime(status: TerminalStatus): void {
  try {
    audio ??= new AudioContext()
    const ctx = audio
    const notes = status === 'needs_input' ? [660, 880] : [523]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const start = ctx.currentTime + i * 0.14
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    })
  } catch {
    // Audio blocked until the first user gesture; the visual cue still shows.
  }
}

export function terminalIdFromHash(hash: string): string | null {
  const match = /^#t=([0-9a-f-]{36})$/i.exec(hash)
  return match?.[1] ?? null
}
