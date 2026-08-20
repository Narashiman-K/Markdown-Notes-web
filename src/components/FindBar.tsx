import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Find in document.
 *
 * The desktop build called Electron's findInPage. A browser has no equivalent a
 * page can drive, so this searches the rendered text itself.
 *
 * It uses the CSS Custom Highlight API where available, which paints matches
 * without touching the DOM — important here, because inserting <mark> elements
 * would corrupt the offsets the annotation engine relies on. Where that API is
 * missing it still scrolls through matches, just without the paint.
 */

interface Props {
  onClose: () => void
}

const HIGHLIGHT_NAME = 'mn-find'
const CURRENT_NAME = 'mn-find-current'

interface HighlightRegistry {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

function registry(): HighlightRegistry | null {
  const css = (window as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
  return css?.highlights ?? null
}

const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight

export default function FindBar({ onClose }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rangesRef = useRef<Range[]>([])

  const clear = useCallback(() => {
    registry()?.delete(HIGHLIGHT_NAME)
    registry()?.delete(CURRENT_NAME)
    // Remove any fallback selection we made in browsers without the API.
    if (!HighlightCtor) window.getSelection()?.removeAllRanges()
    rangesRef.current = []
    setCount(0)
    setIndex(0)
  }, [])

  /**
   * Paints all matches, with the current one in a stronger colour, and scrolls
   * it into view.
   *
   * Registering a Highlight is not enough on its own — the ::highlight() rules
   * in app.css are what make it visible. Where the API is missing we fall back
   * to a real text selection, which the browser highlights natively.
   */
  const paint = useCallback((current: number) => {
    const ranges = rangesRef.current
    if (!ranges.length) return

    const target = ranges[current - 1]

    if (HighlightCtor) {
      const others = ranges.filter((_, i) => i !== current - 1)
      const reg = registry()
      reg?.set(HIGHLIGHT_NAME, new HighlightCtor(...others))
      reg?.set(CURRENT_NAME, new HighlightCtor(target))
    } else {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(target.cloneRange())
    }

    const anchor = target.startContainer.parentElement
    anchor?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    return clear
  }, [clear])

  const search = useCallback(
    (needle: string) => {
      clear()
      const root = document.querySelector('.markdown-body')
      if (!root || needle.trim().length < 1) return

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const ranges: Range[] = []
      const lower = needle.toLowerCase()

      let node = walker.nextNode() as Text | null
      while (node) {
        const value = (node.nodeValue ?? '').toLowerCase()
        let from = value.indexOf(lower)
        while (from !== -1) {
          const range = document.createRange()
          range.setStart(node, from)
          range.setEnd(node, from + needle.length)
          ranges.push(range)
          from = value.indexOf(lower, from + needle.length)
        }
        node = walker.nextNode() as Text | null
      }

      rangesRef.current = ranges
      setCount(ranges.length)
      setIndex(ranges.length ? 1 : 0)
      if (ranges.length) paint(1)
    },
    [clear, paint]
  )

  const step = (forward: boolean): void => {
    const ranges = rangesRef.current
    if (!ranges.length) return
    const next = forward ? (index % ranges.length) + 1 : index <= 1 ? ranges.length : index - 1
    setIndex(next)
    paint(next)
  }

  return (
    <div className="findbar" data-mn-ignore>
      <input
        ref={inputRef}
        value={text}
        placeholder="Find in document"
        onChange={(e) => {
          setText(e.target.value)
          search(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step(!e.shiftKey)
          if (e.key === 'Escape') onClose()
        }}
      />
      <span className="small muted find-count">
        {text ? (count ? `${index} of ${count}` : 'no matches') : ''}
      </span>
      <button title="Previous (Shift+Enter)" onClick={() => step(false)} disabled={!count}>
        ↑
      </button>
      <button title="Next (Enter)" onClick={() => step(true)} disabled={!count}>
        ↓
      </button>
      <button title="Close (Esc)" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
