import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { socket } from '../socket'

interface TerminalViewProps {
  terminalId: string
}

const RESIZE_DEBOUNCE_MS = 50

export function TerminalView({ terminalId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: { background: '#0b0d10', foreground: '#d7dae0', cursor: '#7dd3fc' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    let webgl: WebglAddon | null = null
    const disposeWebgl = () => {
      try {
        webgl?.dispose()
      } catch {
        // xterm may already have torn the renderer down.
      }
      webgl = null
    }
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(disposeWebgl)
      term.loadAddon(webgl)
    } catch {
      // WebGL unavailable: xterm falls back to the DOM renderer.
      webgl = null
    }

    const sendSize = () => {
      fit.fit()
      socket.send({ type: 'resize', terminalId, cols: term.cols, rows: term.rows })
    }

    const detach = socket.attach(terminalId, (kind, data) => {
      if (kind === 'snapshot') term.reset()
      term.write(data)
    })
    const input = term.onData((data) => socket.send({ type: 'input', terminalId, data }))

    let resizeTimer: number | undefined
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(sendSize, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)
    sendSize()
    term.focus()

    return () => {
      observer.disconnect()
      window.clearTimeout(resizeTimer)
      input.dispose()
      detach()
      disposeWebgl()
      try {
        term.dispose()
      } catch {
        // Ignore teardown races inside xterm; the DOM node is going away anyway.
      }
    }
  }, [terminalId])

  return <div className="terminal-host" ref={containerRef} />
}
