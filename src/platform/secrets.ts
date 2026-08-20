/**
 * Credential storage for the browser.
 *
 * HONEST LIMITATION, stated plainly because it matters:
 *
 * The Windows build encrypts API keys with DPAPI, where the operating system
 * holds the secret and the app never sees it. A browser has no equivalent
 * reachable from JavaScript. What we can do is generate an AES-GCM key that the
 * browser marks *non-extractable* — meaning script can ask the browser to
 * encrypt and decrypt with it, but can never read the key material itself, and
 * cannot copy it out of IndexedDB.
 *
 * That defeats: someone reading your stored data, copying the database to
 * another machine, or an extension scraping localStorage for anything that
 * looks like an API key.
 *
 * That does NOT defeat: script running on this exact origin, which can still
 * ask the browser to decrypt on its behalf. If this site were compromised, or
 * you installed an extension with full access to it, the keys are reachable.
 *
 * So it is a real improvement over plain text, and it is not DPAPI. The AI
 * settings panel says as much to the user rather than implying otherwise.
 */

const DB_NAME = 'suprasuta'
const DB_VERSION = 1
const KEY_STORE = 'crypto'
const SECRET_STORE = 'secrets'
const MASTER_KEY_ID = 'master'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of [KEY_STORE, SECRET_STORE, 'documents', 'settings']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbKeys(store: string): Promise<string[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAllKeys()
    request.onsuccess = () => resolve(request.result as string[])
    request.onerror = () => reject(request.error)
  })
}

/* ------------------------------------------------------------ encryption */

/**
 * Fetches the master key, creating it on first use. `extractable: false` is the
 * important part: the browser will use this key on our behalf but will never
 * hand the raw bytes to JavaScript, so it cannot be exfiltrated.
 */
async function masterKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(KEY_STORE, MASTER_KEY_ID)
  if (existing) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
  await idbSet(KEY_STORE, MASTER_KEY_ID, key)
  return key
}

export function isSecureStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto?.subtle !== 'undefined'
}

export async function sealSecret(plain: string): Promise<{ iv: number[]; data: number[] } | null> {
  if (!plain || !isSecureStorageAvailable()) return null
  const key = await masterKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain)
  )
  return { iv: [...iv], data: [...new Uint8Array(encrypted)] }
}

export async function openSecret(stored: { iv: number[]; data: number[] } | undefined): Promise<string> {
  if (!stored?.data?.length) return ''
  try {
    const key = await masterKey()
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(stored.iv) },
      key,
      new Uint8Array(stored.data)
    )
    return new TextDecoder().decode(plain)
  } catch {
    // Wrong key (database restored elsewhere) or corrupted value.
    return ''
  }
}

export const SECRET_STORE_NAME = SECRET_STORE
