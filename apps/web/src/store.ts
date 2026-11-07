import { create } from 'zustand'
import type { TerminalDTO } from '@agentdevs/shared'
import { isAttentionTransition, loadAcks, playChime, saveAcks, type Acks } from './attention'

interface AppState {
  terminals: Record<string, TerminalDTO>
  selectedId: string | null
  isConnected: boolean
  acks: Acks
  setTerminals: (list: TerminalDTO[]) => void
  upsertTerminal: (terminal: TerminalDTO) => void
  removeTerminal: (id: string) => void
  select: (id: string | null) => void
  setConnected: (isConnected: boolean) => void
}

function acknowledge(acks: Acks, terminal: TerminalDTO | undefined): Acks {
  if (!terminal || terminal.status !== 'done' || acks[terminal.id] === terminal.lastActivityAt) return acks
  const next = { ...acks, [terminal.id]: terminal.lastActivityAt }
  saveAcks(next)
  return next
}

export const useAppStore = create<AppState>((set, get) => ({
  terminals: {},
  selectedId: null,
  isConnected: false,
  acks: loadAcks(),
  setTerminals: (list) => set({ terminals: Object.fromEntries(list.map((t) => [t.id, t])) }),
  upsertTerminal: (terminal) => {
    const { terminals, selectedId, acks } = get()
    const previous = terminals[terminal.id]?.status
    if (isAttentionTransition(previous, terminal.status)) playChime(terminal.status)
    // Finishing while you are looking at it (and the tab is visible) counts as seen.
    const isWatching = terminal.id === selectedId && document.visibilityState === 'visible'
    set({
      terminals: { ...terminals, [terminal.id]: terminal },
      acks: isWatching ? acknowledge(acks, terminal) : acks,
    })
  },
  removeTerminal: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.terminals
      return { terminals: rest, selectedId: s.selectedId === id ? null : s.selectedId }
    }),
  select: (id) =>
    set((s) => ({ selectedId: id, acks: id ? acknowledge(s.acks, s.terminals[id]) : s.acks })),
  setConnected: (isConnected) => set({ isConnected }),
}))
