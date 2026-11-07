import { open } from 'node:fs/promises'

const TAIL_BYTES = 256 * 1024

interface TranscriptEntry {
  type?: unknown
  message?: { content?: unknown }
}

function textOf(entry: TranscriptEntry): string | null {
  if (entry.type !== 'assistant') return null
  const content = entry.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = content
    .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
  return texts.length > 0 ? texts.join(' ') : null
}

function cap(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > maxChars ? `${clean.slice(0, maxChars - 1)}…` : clean
}

/** Finds the most recent assistant text in a Claude Code JSONL transcript (or a tail of it). */
export function extractLastAssistantText(jsonl: string, maxChars: number): string | null {
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    const text = textOf(entry)
    if (text && text.trim()) return cap(text, maxChars)
  }
  return null
}

/** Reads only the tail of the transcript: these files grow to many MB. */
export async function readLastAssistantText(path: string, maxChars: number): Promise<string | null> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return extractLastAssistantText(buffer.toString('utf8'), maxChars)
  } finally {
    await handle.close()
  }
}
