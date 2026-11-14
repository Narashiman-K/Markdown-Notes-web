/**
 * Audiobooks for read aloud in the web app.
 *
 * A web page cannot look at the folder a document came from, so the reader
 * links the audiobook once with the file picker: the `.m4b` / `.mp3`, and
 * from Book2Audio its `.b2a.json` timing file too. In Chrome and Edge the
 * browser can remember *which* files were picked (not copies of them: an
 * audiobook is hundreds of megabytes), kept in IndexedDB per document; the
 * next time, one click allows reading them again. Other browsers ask for the
 * files again in each new session. Nothing is uploaded anywhere.
 */

export interface WebAudiobook {
  name: string
  url: string
  sidecar: string | null
  linked: boolean
}

type FileHandle = { name: string; getFile: () => Promise<File>; queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState>; requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState> }
type Picker = (o: unknown) => Promise<FileHandle[]>

const DB = 'mn-audiobooks'
const STORE = 'links'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function put(key: string, value: unknown): Promise<void> {
  const d = await db()
  await new Promise<void>((res, rej) => {
    const t = d.transaction(STORE, 'readwrite')
    if (value === undefined) t.objectStore(STORE).delete(key)
    else t.objectStore(STORE).put(value, key)
    t.oncomplete = () => res()
    t.onerror = () => rej(t.error)
  })
}

async function get<T>(key: string): Promise<T | undefined> {
  const d = await db()
  return new Promise((res, rej) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key)
    r.onsuccess = () => res(r.result as T | undefined)
    r.onerror = () => rej(r.error)
  })
}

const urls = new Map<string, string>()

async function fromFiles(audio: File, json: File | null, key: string): Promise<WebAudiobook> {
  const old = urls.get(key)
  if (old) URL.revokeObjectURL(old)
  const url = URL.createObjectURL(audio)
  urls.set(key, url)
  return { name: audio.name, url, sidecar: json ? await json.text() : null, linked: true }
}

const isAudio = (n: string): boolean => /\.(m4b|m4a|mp3|mp4|aac|ogg|opus|wav)$/i.test(n)

/** Lets the reader pick the audiobook (and its timing file) for a document. */
export async function pickAudiobook(docKey: string): Promise<WebAudiobook | null> {
  const picker = (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker
  if (picker) {
    let handles: FileHandle[]
    try {
      handles = await picker({
        multiple: true,
        types: [{ description: 'Audiobook and its Book2Audio timing file', accept: { 'audio/*': ['.m4b', '.m4a', '.mp3'], 'application/json': ['.json'] } }]
      })
    } catch {
      return null
    }
    const audio = handles.find((h) => isAudio(h.name))
    if (!audio) return null
    const json = handles.find((h) => /\.json$/i.test(h.name)) ?? null
    try {
      await put(docKey, { audio, json })
    } catch {
      /* not remembered; still plays now */
    }
    return fromFiles(await audio.getFile(), json ? await json.getFile() : null, docKey)
  }
  // Browsers without the File System Access API: an ordinary file input.
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.m4b,.m4a,.mp3,.json,audio/*'
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
  const audio = files.find((f) => isAudio(f.name))
  if (!audio) return null
  return fromFiles(audio, files.find((f) => /\.json$/i.test(f.name)) ?? null, docKey)
}

/**
 * The audiobook remembered for a document. `ask` (only from a click) asks the
 * browser for permission again when it needs it; without it, a remembered
 * book that needs permission comes back with an empty url.
 */
export async function rememberedAudiobook(docKey: string, ask = false): Promise<WebAudiobook | null> {
  let saved: { audio: FileHandle; json: FileHandle | null } | undefined
  try {
    saved = await get(docKey)
  } catch {
    return null
  }
  if (!saved?.audio) return null
  const can = async (h: FileHandle): Promise<boolean> => {
    if (!h.queryPermission) return true
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
    return ask && !!h.requestPermission && (await h.requestPermission({ mode: 'read' })) === 'granted'
  }
  try {
    if (!(await can(saved.audio))) return { name: saved.audio.name, url: '', sidecar: null, linked: true }
    const json = saved.json && (await can(saved.json)) ? await saved.json.getFile() : null
    return fromFiles(await saved.audio.getFile(), json, docKey)
  } catch {
    return null
  }
}

export async function forgetAudiobook(docKey: string): Promise<void> {
  try {
    await put(docKey, undefined)
  } catch {
    /* nothing remembered */
  }
}
