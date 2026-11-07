import { useMemo } from 'react'
import type { TerminalDTO, TerminalStatus } from '@agentdevs/shared'
import { needsAttention, type Acks } from '../attention'
import { useAppStore } from '../store'

export const STATUS_LABEL: Record<TerminalStatus, string> = {
  starting: 'Iniciando',
  idle: 'Lista',
  working: 'Trabajando',
  done: 'Terminó',
  needs_input: 'Te necesita',
  exited: 'Cerrada',
  unrestorable: 'No restaurable',
}

const STATUS_ORDER: Record<TerminalStatus, number> = {
  needs_input: 0,
  done: 1,
  working: 2,
  idle: 3,
  starting: 4,
  exited: 5,
  unrestorable: 6,
}

function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
}

function byUrgency(a: TerminalDTO, b: TerminalDTO): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastActivityAt - a.lastActivityAt
}

/** Workers show their repo + branch; others show their folder. */
function subtitle(t: TerminalDTO): string {
  if (t.role === 'worker' && t.repoPath) return `${folderName(t.repoPath)} · ${t.branch ?? ''}`
  return folderName(t.cwd)
}

interface ItemProps {
  terminal: TerminalDTO
  isSelected: boolean
  acks: Acks
  isNested?: boolean
  onSelect: (id: string) => void
}

function TerminalItem({ terminal: t, isSelected, acks, isNested, onSelect }: ItemProps) {
  return (
    <li className={isNested ? 'nested' : undefined}>
      <button
        className={`term-item ${isSelected ? 'active' : ''} ${needsAttention(t, acks) ? 'attention' : ''}`}
        onClick={() => onSelect(t.id)}
        title={t.lastSummary ?? undefined}
      >
        <span className={`dot status-${t.status}`} aria-hidden />
        <span className="term-meta">
          <span className="term-title">
            {t.role === 'pm' && <span className="role-badge">PM</span>}
            {t.title}
          </span>
          <span className="term-sub">{subtitle(t)} · {STATUS_LABEL[t.status]}</span>
          {t.lastSummary && (t.status === 'done' || t.status === 'needs_input') && (
            <span className="term-summary">{t.lastSummary}</span>
          )}
        </span>
      </button>
    </li>
  )
}

interface SidebarProps {
  onNew: () => void
  onImport: () => void
  onOpenPm: () => void
}

export function Sidebar({ onNew, onImport, onOpenPm }: SidebarProps) {
  const terminals = useAppStore((s) => s.terminals)
  const selectedId = useAppStore((s) => s.selectedId)
  const select = useAppStore((s) => s.select)
  const acks = useAppStore((s) => s.acks)

  const { pm, workers, others } = useMemo(() => {
    const all = Object.values(terminals)
    const pmTerminal = all.find((t) => t.role === 'pm') ?? null
    return {
      pm: pmTerminal,
      workers: all.filter((t) => t.role === 'worker' && t.parentId === pmTerminal?.id).sort(byUrgency),
      others: all.filter((t) => t.role !== 'pm' && !(t.role === 'worker' && t.parentId === pmTerminal?.id)).sort(byUrgency),
    }
  }, [terminals])

  const itemProps = (t: TerminalDTO) => ({ terminal: t, isSelected: t.id === selectedId, acks, onSelect: select })

  return (
    <aside className="sidebar">
      <button className="new-btn" onClick={onOpenPm}>{pm ? 'Ir al PM' : 'Abrir PM'}</button>
      <div className="sidebar-actions">
        <button className="ghost" onClick={onNew}>+ Terminal</button>
        <button className="ghost" onClick={onImport}>Importar</button>
      </div>
      <p className="hint">Alt+J: ir a la próxima que te necesita</p>

      {pm && (
        <>
          <h3 className="section-title">Misión</h3>
          <ul>
            <TerminalItem {...itemProps(pm)} />
            {workers.map((w) => (
              <TerminalItem key={w.id} {...itemProps(w)} isNested />
            ))}
          </ul>
        </>
      )}

      {(others.length > 0 || !pm) && <h3 className="section-title">Terminales</h3>}
      <ul>
        {others.map((t) => (
          <TerminalItem key={t.id} {...itemProps(t)} />
        ))}
        {others.length === 0 && !pm && <li className="empty">Todavía no hay terminales.</li>}
      </ul>
    </aside>
  )
}
