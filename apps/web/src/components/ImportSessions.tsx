import { useEffect, useState } from 'react'
import type { RecentSessionDTO } from '@agentdevs/shared'
import { api } from '../api'
import { useAppStore } from '../store'

interface ImportSessionsProps {
  onDone: () => void
}

const MINUTE = 60_000

function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / MINUTE)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`
}

function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
}

export function ImportSessions({ onDone }: ImportSessionsProps) {
  const [sessions, setSessions] = useState<RecentSessionDTO[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const select = useAppStore((s) => s.select)

  useEffect(() => {
    api
      .recentSessions()
      .then(setSessions)
      .catch((err: unknown) => setErrors([err instanceof Error ? err.message : 'No pude leer las sesiones']))
  }, [])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async () => {
    setIsImporting(true)
    setErrors([])
    try {
      const result = await api.importSessions({ sessions: [...selected].map((sessionId) => ({ sessionId })) })
      if (result.imported[0]) select(result.imported[0].id)
      if (result.errors.length > 0) setErrors(result.errors)
      else onDone()
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : 'No se pudo importar'])
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <section className="import">
      <h2>Importar sesiones de Claude</h2>
      <p className="warning">
        Cerrá primero la terminal original de cada sesión que importes. Si la misma conversación corre en dos lugares a la vez,
        se pisan.
      </p>
      {sessions === null && errors.length === 0 && <p className="muted">Buscando sesiones de los últimos 3 días…</p>}
      {sessions?.length === 0 && <p className="muted">No encontré sesiones recientes para importar.</p>}
      <ul className="session-list">
        {sessions?.map((s) => (
          <li key={s.sessionId}>
            <label className={selected.has(s.sessionId) ? 'checked' : ''}>
              <input type="checkbox" checked={selected.has(s.sessionId)} onChange={() => toggle(s.sessionId)} />
              <span className="session-meta">
                <span className="session-title">{s.title}</span>
                <span className="muted">
                  {folderName(s.cwd)}
                  {s.gitBranch ? ` · ${s.gitBranch}` : ''} · {timeAgo(s.lastActivityAt)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {errors.map((e) => (
        <p key={e} className="form-error">{e}</p>
      ))}
      <div className="form-actions">
        <button className="ghost" onClick={onDone}>Cancelar</button>
        <button onClick={submit} disabled={selected.size === 0 || isImporting}>
          {isImporting ? 'Importando…' : `Importar ${selected.size || ''}`.trim()}
        </button>
      </div>
    </section>
  )
}
