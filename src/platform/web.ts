/**
 * Browser implementation of the Platform contract.
 *
 * File handling adapts to what the browser can actually do:
 *   Chrome / Edge desktop  File System Access API — genuine open and save-in-place
 *   everything else        upload to open, download to save, plus an in-app library
 *
 * AI provider routing is decided by CORS, not preference:
 *   Gemini, Anthropic  called directly from the browser
 *   OpenAI, AssemblyAI  relayed through our own serverless function, because
 *                       both refuse cross-origin browser requests
 *   Ollama              http://127.0.0.1:11434, desktop only
 */
import type {
  Platform,
  Capabilities,
  OpenDocument,
  OpenResult,
  SavedDocument,
  Settings,
  KeyName,
  ProviderId,
  ChatRequest,
  ChatResponse
} from './types'
import { idbGet, idbSet, idbDelete, idbKeys, sealSecret, openSecret, SECRET_STORE_NAME } from './secrets'
import { isConvertible, isReadableText } from '../shared/formats'

const OLLAMA = 'http://127.0.0.1:11434'
const PROXY = '/api'

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  zoom: 1,
  aiProvider: 'gemini',
  aiModel: '',
  aiReviewChanges: true,
  convertOpenAfter: 'ask',
  lastDocumentId: null
}

const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  ollama: [],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']
}

/* ------------------------------------------------------------- utilities */

interface FilePickerAccept {
  description?: string
  accept: Record<string, string[]>
}

interface WindowWithFs extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean
    types?: FilePickerAccept[]
  }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: FilePickerAccept[]
  }) => Promise<FileSystemFileHandle>
}

const win = window as WindowWithFs

function download(name: string, data: string | Blob, mimeType: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const MARKDOWN_TYPES: FilePickerAccept[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] } },
  { description: 'Text', accept: { 'text/plain': ['.txt'] } }
]

export class WebPlatform implements Platform {
  readonly capabilities: Capabilities

  constructor() {
    this.capabilities = {
      fileSystemAccess: typeof win.showOpenFilePicker === 'function',
      // Ollama listens on the user's own machine; a phone can never reach it.
      localAi: !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
      proxy: true,
      native: false,
      touch: matchMedia('(pointer: coarse)').matches
    }
  }

  /* ---------------------------------------------------------------- files */

  async openDocument(): Promise<OpenResult> {
    try {
      if (this.capabilities.fileSystemAccess && win.showOpenFilePicker) {
        const [handle] = await win.showOpenFilePicker({ multiple: false })
        const file = await handle.getFile()
        if (!isReadableText(file.name)) {
          return isConvertible(file.name)
            ? { ok: true, needsConversion: true, file }
            : { ok: false, error: `Cannot open .${file.name.split('.').pop()} files.` }
        }
        return {
          ok: true,
          doc: { id: null, name: file.name, content: await file.text(), handle, canSaveInPlace: true }
        }
      }

      // Fallback: a plain file input, which every browser supports.
      const file = await pickWithInput(false).then((files) => files[0])
      if (!file) return { ok: false, canceled: true }
      if (!isReadableText(file.name)) {
        return isConvertible(file.name)
          ? { ok: true, needsConversion: true, file }
          : { ok: false, error: `Cannot open .${file.name.split('.').pop()} files.` }
      }
      return {
        ok: true,
        doc: { id: null, name: file.name, content: await file.text(), canSaveInPlace: false }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return { ok: false, canceled: true }
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  }

  async saveDocument(doc: OpenDocument, content: string): Promise<OpenResult> {
    // Write straight back to the user's file when the browser allows it.
    if (doc.canSaveInPlace && doc.handle) {
      try {
        const handle = doc.handle as FileSystemFileHandle & {
          createWritable: () => Promise<FileSystemWritableFileStream>
        }
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
        return { ok: true, doc: { ...doc, content } }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }

    // Otherwise keep it in the in-app library, which survives a reload.
    const id = await this.storeDocument(doc.name, content, doc.id ?? undefined)
    return { ok: true, doc: { ...doc, id, content, canSaveInPlace: false } }
  }

  async saveDocumentAs(doc: OpenDocument, content: string): Promise<OpenResult> {
    const suggested = doc.name.endsWith('.md') ? doc.name : `${doc.name.replace(/\.[^.]+$/, '')}.md`
    try {
      if (this.capabilities.fileSystemAccess && win.showSaveFilePicker) {
        const handle = await win.showSaveFilePicker({ suggestedName: suggested, types: MARKDOWN_TYPES })
        const writable = await (
          handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }
        ).createWritable()
        await writable.write(content)
        await writable.close()
        return { ok: true, doc: { id: doc.id, name: handle.name, content, handle, canSaveInPlace: true } }
      }
      download(suggested, content, 'text/markdown')
      return { ok: true, doc: { ...doc, name: suggested, content } }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return { ok: false, canceled: true }
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  }

  async readBytes(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer())
  }

  async pickFilesToConvert(): Promise<File[]> {
    return pickWithInput(true)
  }

  async exportFile(name: string, data: string | Blob, mimeType: string): Promise<void> {
    download(name, data, mimeType)
  }

  /* -------------------------------------------------------------- library */

  async listDocuments(): Promise<SavedDocument[]> {
    const ids = await idbKeys('documents')
    const docs = await Promise.all(
      ids.map(async (id) => {
        const d = await idbGet<{ name: string; content: string; updatedAt: number }>('documents', id)
        return d ? { id, name: d.name, updatedAt: d.updatedAt, size: d.content.length } : null
      })
    )
    return docs.filter((d): d is SavedDocument => d !== null).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async loadDocument(id: string): Promise<OpenDocument | null> {
    const d = await idbGet<{ name: string; content: string }>('documents', id)
    return d ? { id, name: d.name, content: d.content, canSaveInPlace: false } : null
  }

  async storeDocument(name: string, content: string, id?: string): Promise<string> {
    const key = id ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await idbSet('documents', key, { name, content, updatedAt: Date.now() })
    return key
  }

  async deleteDocument(id: string): Promise<void> {
    await idbDelete('documents', id)
  }

  /* ------------------------------------------------------------- settings */

  async getSettings(): Promise<Settings> {
    const saved = await idbGet<Partial<Settings>>('settings', 'app')
    return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch }
    await idbSet('settings', 'app', next)
    return next
  }

  /* ---------------------------------------------------------- credentials */

  async keyState(): Promise<Record<KeyName, boolean>> {
    const names: KeyName[] = ['anthropic', 'openai', 'gemini', 'assemblyai']
    const entries = await Promise.all(names.map(async (n) => [n, await this.hasKey(n)] as const))
    return Object.fromEntries(entries) as Record<KeyName, boolean>
  }

  async setKey(name: KeyName, value: string): Promise<void> {
    if (!value) {
      await idbDelete(SECRET_STORE_NAME, name)
      return
    }
    const sealed = await sealSecret(value.trim())
    if (sealed) await idbSet(SECRET_STORE_NAME, name, sealed)
  }

  async hasKey(name: KeyName): Promise<boolean> {
    return (await this.readKey(name)).length > 0
  }

  private async readKey(name: KeyName): Promise<string> {
    const stored = await idbGet<{ iv: number[]; data: number[] }>(SECRET_STORE_NAME, name)
    return openSecret(stored)
  }

  /* ------------------------------------------------------------------- AI */

  async aiStatus(provider: ProviderId): Promise<{ ready: boolean; detail: string }> {
    if (provider === 'ollama') {
      if (!this.capabilities.localAi) {
        return { ready: false, detail: 'Ollama runs on a computer, so it is not available on this device' }
      }
      try {
        const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) })
        if (!r.ok) return { ready: false, detail: `Ollama replied ${r.status}` }
        const count = ((await r.json()) as { models?: unknown[] }).models?.length ?? 0
        return count
          ? { ready: true, detail: `Ollama running · ${count} model${count > 1 ? 's' : ''}` }
          : { ready: false, detail: 'Ollama running but no models pulled' }
      } catch {
        return {
          ready: false,
          detail: 'Ollama not reachable. It must be running locally and allow this site via OLLAMA_ORIGINS.'
        }
      }
    }
    return (await this.hasKey(provider))
      ? { ready: true, detail: 'API key saved' }
      : { ready: false, detail: 'No API key saved' }
  }

  async aiModels(provider: ProviderId): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      if (provider === 'ollama') {
        const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(8000) })
        const data = (await r.json()) as { models?: Array<{ name: string }> }
        return { ok: true, models: (data.models ?? []).map((m) => m.name) }
      }

      const key = await this.readKey(provider)
      if (!key) return { ok: false, error: 'No API key saved.' }

      if (provider === 'gemini') {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
        )
        if (!r.ok) return { ok: false, error: `Gemini replied ${r.status}`, models: FALLBACK_MODELS.gemini }
        const data = (await r.json()) as {
          models?: Array<{ name: string; supportedGenerationMethods?: string[] }>
        }
        return {
          ok: true,
          models: (data.models ?? [])
            .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
            .map((m) => m.name.replace(/^models\//, ''))
        }
      }

      if (provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            // Anthropic requires this explicit opt-in for browser requests.
            'anthropic-dangerous-direct-browser-access': 'true'
          }
        })
        if (!r.ok) return { ok: false, error: `Anthropic replied ${r.status}`, models: FALLBACK_MODELS.anthropic }
        const data = (await r.json()) as { data?: Array<{ id: string }> }
        return { ok: true, models: (data.data ?? []).map((m) => m.id) }
      }

      // OpenAI blocks browser requests outright, so this goes via our proxy.
      const r = await fetch(`${PROXY}/openai?path=models`, { headers: { 'x-api-key': key } })
      if (!r.ok) return { ok: false, error: `OpenAI replied ${r.status}`, models: FALLBACK_MODELS.openai }
      const data = (await r.json()) as { data?: Array<{ id: string }> }
      return {
        ok: true,
        models: (data.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/i.test(id)).sort()
      }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err), models: FALLBACK_MODELS[provider] }
    }
  }

  async aiChat(req: ChatRequest): Promise<ChatResponse> {
    const maxTokens = req.maxTokens ?? 2048
    const temperature = req.temperature ?? 0.2

    try {
      if (req.provider === 'ollama') {
        const r = await fetch(`${OLLAMA}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: req.model,
            stream: false,
            options: { temperature, num_predict: maxTokens },
            messages: [{ role: 'system', content: req.system }, ...req.messages]
          })
        })
        if (!r.ok) return { ok: false, error: `Ollama replied ${r.status}` }
        return { ok: true, text: ((await r.json()) as { message?: { content?: string } }).message?.content ?? '' }
      }

      const key = await this.readKey(req.provider)
      if (!key) return { ok: false, code: 'NO_KEY', error: `No ${req.provider} API key saved.` }

      if (req.provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: req.model,
            max_tokens: maxTokens,
            temperature,
            system: req.system,
            messages: req.messages
          })
        })
        const data = (await r.json()) as {
          content?: Array<{ type: string; text?: string }>
          error?: { message?: string }
        }
        if (!r.ok) return { ok: false, code: r.status === 401 ? 'BAD_KEY' : 'HTTP', error: data.error?.message }
        return {
          ok: true,
          text: (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
        }
      }

      if (req.provider === 'gemini') {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: req.system }] },
              generationConfig: { temperature, maxOutputTokens: maxTokens },
              contents: req.messages.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
              }))
            })
          }
        )
        const data = (await r.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
          error?: { message?: string }
        }
        if (!r.ok) return { ok: false, code: 'HTTP', error: data.error?.message }
        return {
          ok: true,
          text: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
        }
      }

      // OpenAI — via the proxy.
      const r = await fetch(`${PROXY}/openai?path=chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({
          model: req.model,
          temperature,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: req.system }, ...req.messages]
        })
      })
      const data = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        error?: { message?: string }
      }
      if (!r.ok) return { ok: false, code: r.status === 401 ? 'BAD_KEY' : 'HTTP', error: data.error?.message }
      return { ok: true, text: data.choices?.[0]?.message?.content ?? '' }
    } catch (err) {
      return { ok: false, code: 'NETWORK', error: String((err as Error)?.message ?? err) }
    }
  }

  async visionOcr(bytes: Uint8Array, mimeType: string): Promise<string> {
    const key = await this.readKey('gemini')
    if (!key) throw new Error('No Google Gemini API key saved.')

    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const base64 = btoa(binary)

    for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inlineData: { mimeType, data: base64 } },
                  {
                    text:
                      'Perform full OCR text extraction on this image. Transcribe all text accurately into clean Markdown. ' +
                      'If there are charts, tables or diagrams, describe them beneath the text. Do not wrap your answer in a code fence.'
                  }
                ]
              }
            ]
          })
        }
      )
      if (r.ok) {
        const data = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
        if (text.trim()) return text
      }
    }
    throw new Error('Could not read text from this image.')
  }

  async transcribeAudio(bytes: Uint8Array, onProgress: (m: string) => void): Promise<string> {
    const key = await this.readKey('assemblyai')
    if (!key) throw new Error('No AssemblyAI API key saved.')

    // AssemblyAI does not permit cross-origin browser requests, so both the
    // upload and the polling go through our own proxy.
    onProgress('Uploading the audio…')
    const upload = await fetch(`${PROXY}/assemblyai?path=upload`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit
    })
    if (!upload.ok) throw new Error(`Upload failed (${upload.status}).`)
    const { upload_url: audioUrl } = (await upload.json()) as { upload_url: string }

    onProgress('Queued for transcription…')
    const created = await fetch(`${PROXY}/assemblyai?path=transcript`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true })
    })
    if (!created.ok) throw new Error(`Transcription request failed (${created.status}).`)
    const { id } = (await created.json()) as { id: string }

    const deadline = Date.now() + 30 * 60_000
    let waited = 0
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      waited += 3
      const poll = await fetch(`${PROXY}/assemblyai?path=transcript/${id}`, { headers: { 'x-api-key': key } })
      const data = (await poll.json()) as { status: string; text?: string; error?: string }
      if (data.status === 'completed') return data.text ?? ''
      if (data.status === 'error') throw new Error(data.error ?? 'Transcription failed.')
      onProgress(`Transcribing… (${waited}s)`)
    }
    throw new Error('Transcription did not finish within 30 minutes.')
  }

  /* --------------------------------------------------------------- system */

  async print(html: string): Promise<void> {
    // A hidden iframe prints just the document, without the app interface.
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    if (!doc) return
    doc.open()
    doc.write(html)
    doc.close()
    await new Promise((r) => setTimeout(r, 400))
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }

  setTitle(name: string, dirty: boolean): void {
    document.title = `${dirty ? '• ' : ''}${name} — Suprasūtā Markdown Notes`
  }

  openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** File input fallback for browsers without the File System Access API. */
function pickWithInput(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}
