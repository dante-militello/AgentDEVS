import { useEffect, useState } from 'react'
import { api } from './api'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ImportSessions } from './components/ImportSessions'
import { NewTerminalForm } from './components/NewTerminalForm'
import { Sidebar, STATUS_LABEL } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { useAppStore } from './store'
import { useAttentionEffects } from './useAttentionEffects'

export function App() {
  useAttentionEffects()
  const [panel, setPanel] = useState<'none' | 'create' | 'import'>('none')
  const [actionError, setActionError] = useState<string | null>(null)
  const selected = useAppStore((s) => (s.selectedId ? s.terminals[s.selectedId] : undefined))
  const isConnected = useAppStore((s) => s.isConnected)
  const selectedId = useAppStore((s) => s.selectedId)

  // Picking a terminal in the sidebar closes any open form.
  useEffect(() => setPanel('none'), [selectedId])

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Algo salió mal')
    }
  }

  return (
    <div className="layout">
      <Sidebar
        onNew={() => setPanel('create')}
        onImport={() => setPanel('import')}
        onOpenPm={() =>
          run(async () => {
            const pm = await api.openPm()
            useAppStore.getState().upsertTerminal(pm)
            useAppStore.getState().select(pm.id)
            setPanel('none')
          })
        }
      />
      <main className="main">
        {!isConnected && <div className="banner">Reconectando con el servidor…</div>}
        {actionError && <div className="banner error">{actionError}</div>}
        {panel === 'create' ? (
          <NewTerminalForm onDone={() => setPanel('none')} />
        ) : panel === 'import' ? (
          <ImportSessions onDone={() => setPanel('none')} />
        ) : selected ? (
          <>
            <header className="term-header">
              <div>
                <h1>{selected.title}</h1>
                <p>{selected.cwd} · {STATUS_LABEL[selected.status]}</p>
                {selected.lastSummary && <p className="summary">{selected.lastSummary}</p>}
              </div>
              <div className="header-actions">
                {!selected.isAlive && (
                  <button onClick={() => run(() => api.relaunchTerminal(selected.id))}>Reabrir sesión</button>
                )}
                <button className="ghost danger" onClick={() => run(() => api.removeTerminal(selected.id))}>
                  Cerrar y archivar
                </button>
              </div>
            </header>
            {selected.isAlive ? (
              <ErrorBoundary
                key={selected.id}
                fallback={(reset) => (
                  <div className="placeholder">
                    La terminal tuvo un error de dibujo. <button onClick={reset}>Recargar terminal</button>
                  </div>
                )}
              >
                <TerminalView terminalId={selected.id} />
              </ErrorBoundary>
            ) : (
              <div className="placeholder">La sesión está cerrada. "Reabrir sesión" la retoma con todo su contexto.</div>
            )}
          </>
        ) : (
          <div className="placeholder">Elegí una terminal o abrí una nueva.</div>
        )}
      </main>
    </div>
  )
}
