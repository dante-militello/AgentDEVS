import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAppStore } from '../store'

interface NewTerminalFormProps {
  onDone: () => void
}

export function NewTerminalForm({ onDone }: NewTerminalFormProps) {
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('E:\\Proyectos\\')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const select = useAppStore((s) => s.select)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const terminal = await api.createTerminal({ title, cwd })
      select(terminal.id)
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la terminal')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="new-terminal" onSubmit={submit}>
      <label>
        ¿De qué se trata?
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: refactor del login" required maxLength={120} />
      </label>
      <label>
        Carpeta
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} required spellCheck={false} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="ghost" onClick={onDone}>Cancelar</button>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Abriendo…' : 'Abrir Claude'}</button>
      </div>
    </form>
  )
}
