/**
 * The documents open in this app's other browser tabs, for Compare documents.
 *
 * Tabs of the same site talk over a BroadcastChannel, which never leaves the
 * browser. Each tab answers "who is open?" with its document's name, hands
 * over its text when asked, and takes text back when the comparison saves
 * into it (as an undoable change there, like any edit).
 */

export interface TabDocument {
  tabId: string
  name: string
}

interface Handlers {
  current: () => { name: string; content: string }
  apply: (content: string, label: string) => void
}

const CHANNEL = 'suprasuta-compare'
const tabId = Math.random().toString(36).slice(2, 10)
let channel: BroadcastChannel | null = null

type Msg =
  | { type: 'list'; from: string }
  | { type: 'here'; to: string; tabId: string; name: string }
  | { type: 'get'; to: string; from: string; req: string }
  | { type: 'text'; to: string; req: string; name: string; content: string }
  | { type: 'set'; to: string; from: string; req: string; content: string }
  | { type: 'done'; to: string; req: string }

/** Starts answering other tabs. Returns a function that stops it. */
export function startTabLink(handlers: Handlers): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(CHANNEL)
  const ch = channel
  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data
    if (m.type === 'list') {
      ch.postMessage({ type: 'here', to: m.from, tabId, name: handlers.current().name } satisfies Msg)
    } else if (m.type === 'get' && m.to === tabId) {
      const doc = handlers.current()
      ch.postMessage({ type: 'text', to: m.from, req: m.req, name: doc.name, content: doc.content } satisfies Msg)
    } else if (m.type === 'set' && m.to === tabId) {
      handlers.apply(m.content, 'Changes from Compare documents')
      ch.postMessage({ type: 'done', to: m.from, req: m.req } satisfies Msg)
    }
  }
  return () => {
    ch.close()
    if (channel === ch) channel = null
  }
}

function request<T>(send: Msg, match: (m: Msg) => T | undefined, wait: number): Promise<T | null> {
  return new Promise((resolve) => {
    if (typeof BroadcastChannel === 'undefined') return resolve(null)
    const ch = new BroadcastChannel(CHANNEL)
    const timer = setTimeout(() => {
      ch.close()
      resolve(null)
    }, wait)
    ch.onmessage = (e: MessageEvent<Msg>) => {
      const got = match(e.data)
      if (got !== undefined) {
        clearTimeout(timer)
        ch.close()
        resolve(got)
      }
    }
    ch.postMessage(send)
  })
}

/** The documents open in the other tabs (those that answer within half a second). */
export function otherTabs(): Promise<TabDocument[]> {
  return new Promise((resolve) => {
    if (typeof BroadcastChannel === 'undefined') return resolve([])
    const ch = new BroadcastChannel(CHANNEL)
    const found: TabDocument[] = []
    ch.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data
      if (m.type === 'here' && m.to === tabId && m.tabId !== tabId) found.push({ tabId: m.tabId, name: m.name })
    }
    ch.postMessage({ type: 'list', from: tabId } satisfies Msg)
    setTimeout(() => {
      ch.close()
      resolve(found)
    }, 500)
  })
}

export function tabText(other: string): Promise<{ name: string; content: string } | null> {
  const req = Math.random().toString(36).slice(2)
  return request(
    { type: 'get', to: other, from: tabId, req },
    (m) => (m.type === 'text' && m.req === req ? { name: m.name, content: m.content } : undefined),
    3000
  )
}

export async function setTabText(other: string, content: string): Promise<boolean> {
  const req = Math.random().toString(36).slice(2)
  return (await request({ type: 'set', to: other, from: tabId, req, content }, (m) => (m.type === 'done' && m.req === req ? true : undefined), 3000)) === true
}
