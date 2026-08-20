/**
 * The contract between the application and whatever it is running on.
 *
 * Everything platform-specific lives behind this interface: file access,
 * persistence, printing, credentials and network calls to AI providers. The
 * components and everything in `lib/` know nothing about browsers, Electron or
 * Capacitor — they only know this.
 *
 * Implementations:
 *   web.ts        browsers, using File System Access API where available
 *   capacitor.ts  Android, overriding file handling with native storage
 */

/** A document the app currently has open. */
export interface OpenDocument {
  /** Stable id used by the in-app library. Null for a file opened from disk. */
  id: string | null
  name: string
  content: string
  /** Present when the browser granted a real file handle we can save back to. */
  handle?: unknown
  /** True when saving writes straight back to the user's file. */
  canSaveInPlace: boolean
}

export interface SavedDocument {
  id: string
  name: string
  updatedAt: number
  size: number
}

export interface OpenResult {
  ok: boolean
  doc?: OpenDocument
  /** Set when the format needs converting before it can be shown. */
  needsConversion?: boolean
  file?: File
  error?: string
  canceled?: boolean
}

export type ProviderId = 'ollama' | 'anthropic' | 'openai' | 'gemini'
export type KeyName = 'anthropic' | 'openai' | 'gemini' | 'assemblyai'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  provider: ProviderId
  model: string
  system: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface ChatResponse {
  ok: boolean
  text?: string
  error?: string
  code?: string
}

export interface Settings {
  theme: 'light' | 'dark' | 'system'
  zoom: number
  aiProvider: ProviderId
  aiModel: string
  aiReviewChanges: boolean
  convertOpenAfter: 'ask' | 'always' | 'never'
  lastDocumentId: string | null
}

export interface Capabilities {
  /** File System Access API — real open/save, Chrome and Edge on desktop. */
  fileSystemAccess: boolean
  /** Ollama is only reachable from a desktop browser on the same machine. */
  localAi: boolean
  /** Serverless proxy deployed, so OpenAI and audio transcription work. */
  proxy: boolean
  /** Running inside a Capacitor native shell rather than a plain browser. */
  native: boolean
  touch: boolean
}

export interface Platform {
  readonly capabilities: Capabilities

  /* ---------------------------------------------------------------- files */

  /** Opens a picker. Returns the document, or a File needing conversion. */
  openDocument(): Promise<OpenResult>
  /** Saves back to the original file when possible, otherwise downloads. */
  saveDocument(doc: OpenDocument, content: string): Promise<OpenResult>
  /** Always prompts for a destination. */
  saveDocumentAs(doc: OpenDocument, content: string): Promise<OpenResult>
  /** Reads raw bytes from a File, for the converters. */
  readBytes(file: File): Promise<Uint8Array>
  /** Picks one or more files for conversion. */
  pickFilesToConvert(): Promise<File[]>
  /** Offers a produced file to the user (download, or native share). */
  exportFile(name: string, data: string | Blob, mimeType: string): Promise<void>

  /* -------------------------------------------------------------- library */

  listDocuments(): Promise<SavedDocument[]>
  loadDocument(id: string): Promise<OpenDocument | null>
  storeDocument(name: string, content: string, id?: string): Promise<string>
  deleteDocument(id: string): Promise<void>

  /* ------------------------------------------------------------- settings */

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>

  /* --------------------------------------------------------- credentials */

  /** Which keys are stored. Never returns the keys themselves. */
  keyState(): Promise<Record<KeyName, boolean>>
  setKey(name: KeyName, value: string): Promise<void>
  hasKey(name: KeyName): Promise<boolean>

  /* --------------------------------------------------------------- AI */

  aiStatus(provider: ProviderId): Promise<{ ready: boolean; detail: string }>
  aiModels(provider: ProviderId): Promise<{ ok: boolean; models?: string[]; error?: string }>
  aiChat(request: ChatRequest): Promise<ChatResponse>
  visionOcr(bytes: Uint8Array, mimeType: string): Promise<string>
  transcribeAudio(bytes: Uint8Array, onProgress: (m: string) => void): Promise<string>

  /* ------------------------------------------------------------- system */

  print(html: string): Promise<void>
  setTitle(name: string, dirty: boolean): void
  openExternal(url: string): void
}
