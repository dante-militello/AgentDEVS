import { useEffect, useMemo } from 'react'
import { needsAttention, terminalIdFromHash } from './attention'
import { useAppStore } from './store'

const BASE_TITLE = 'AgentDEVS'

/** Tab title counter, #t=<id> deep links (used by the Windows toast), and Alt+J to jump. */
export function useAttentionEffects(): void {
  const terminals = useAppStore((s) => s.terminals)
  const acks = useAppStore((s) => s.acks)
  const select = useAppStore((s) => s.select)

  const waiting = useMemo(
    () =>
      Object.values(terminals)
        .filter((t) => needsAttention(t, acks))
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt),
    [terminals, acks],
  )

  useEffect(() => {
    document.title = waiting.length > 0 ? `(${waiting.length}) ${BASE_TITLE}` : BASE_TITLE
  }, [waiting.length])

  useEffect(() => {
    const applyHash = () => {
      const id = terminalIdFromHash(location.hash)
      if (id && useAppStore.getState().terminals[id]) {
        select(id)
        history.replaceState(null, '', location.pathname)
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [select, terminals])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== 'j') return
      const next = waiting[0]
      if (!next) return
      event.preventDefault()
      select(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [waiting, select])
}
