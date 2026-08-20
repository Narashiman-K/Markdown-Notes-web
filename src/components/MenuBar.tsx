import { platform } from '../platform'
import { useEffect, useRef, useState } from 'react'
import { PRIVACY_URL, REPO_URL, featureRequestUrl } from '../shared/brand'

/**
 * In-app menu bar.
 *
 * The desktop build used the native Windows menu, which does not exist in a
 * browser. This reproduces the same commands and shortcuts. On touch devices it
 * collapses to a single button, since a menu bar is unusable on a phone.
 */

interface MenuItem {
  label: string
  action?: string
  accelerator?: string
  separator?: boolean
  href?: string
}

interface Menu {
  label: string
  items: MenuItem[]
}

const MENUS: Menu[] = [
  {
    label: 'File',
    items: [
      { label: 'New', action: 'file:new', accelerator: 'Ctrl+N' },
      { label: 'Open…', action: 'file:open', accelerator: 'Ctrl+O' },
      { label: 'My documents', action: 'file:library' },
      { separator: true, label: '' },
      { label: 'Save', action: 'file:save', accelerator: 'Ctrl+S' },
      { label: 'Save as…', action: 'file:saveAs', accelerator: 'Ctrl+Shift+S' },
      { separator: true, label: '' },
      { label: 'Export as HTML…', action: 'file:export:html' },
      { label: 'Export as PDF…', action: 'file:export:pdf' },
      { label: 'Export without annotations…', action: 'file:export:clean' },
      { separator: true, label: '' },
      { label: 'Convert to Markdown…', action: 'convert:open', accelerator: 'Ctrl+Shift+M' },
      { separator: true, label: '' },
      { label: 'Print…', action: 'file:print', accelerator: 'Ctrl+P' }
    ]
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', action: 'edit:undo', accelerator: 'Ctrl+Z' },
      { label: 'Redo', action: 'edit:redo', accelerator: 'Ctrl+Y' },
      { separator: true, label: '' },
      { label: 'Find…', action: 'edit:find', accelerator: 'Ctrl+F' }
    ]
  },
  {
    label: 'View',
    items: [
      { label: 'View mode', action: 'view:mode:view', accelerator: 'Ctrl+Shift+V' },
      { label: 'Edit mode', action: 'view:mode:edit', accelerator: 'Ctrl+E' },
      { separator: true, label: '' },
      { label: 'Zoom in', action: 'view:zoom:in', accelerator: 'Ctrl+=' },
      { label: 'Zoom out', action: 'view:zoom:out', accelerator: 'Ctrl+-' },
      { label: 'Reset zoom', action: 'view:zoom:reset', accelerator: 'Ctrl+0' },
      { separator: true, label: '' },
      { label: 'Outline', action: 'view:sidebar:outline', accelerator: 'Ctrl+Shift+O' },
      { label: 'Annotations', action: 'view:sidebar:comments', accelerator: 'Ctrl+Shift+C' },
      { separator: true, label: '' },
      { label: 'Light theme', action: 'view:theme:light' },
      { label: 'Dark theme', action: 'view:theme:dark' },
      { label: 'Follow system', action: 'view:theme:system' }
    ]
  },
  {
    label: 'Insert',
    items: [
      { label: 'Bold', action: 'insert:bold', accelerator: 'Ctrl+B' },
      { label: 'Italic', action: 'insert:italic', accelerator: 'Ctrl+I' },
      { label: 'Inline code', action: 'insert:code' },
      { separator: true, label: '' },
      { label: 'Heading 1', action: 'insert:h1' },
      { label: 'Heading 2', action: 'insert:h2' },
      { label: 'Heading 3', action: 'insert:h3' },
      { separator: true, label: '' },
      { label: 'Bullet list', action: 'insert:ul' },
      { label: 'Numbered list', action: 'insert:ol' },
      { label: 'Task list item', action: 'insert:task' },
      { label: 'Block quote', action: 'insert:quote' },
      { separator: true, label: '' },
      { label: 'Link…', action: 'insert:link', accelerator: 'Ctrl+K' },
      { label: 'Table', action: 'insert:table' },
      { label: 'Code block', action: 'insert:codeblock' },
      { label: 'Horizontal rule', action: 'insert:hr' }
    ]
  },
  {
    label: 'Annotate',
    items: [
      { label: 'Highlight yellow', action: 'annot:highlight:yellow' },
      { label: 'Highlight green', action: 'annot:highlight:green' },
      { label: 'Highlight blue', action: 'annot:highlight:blue' },
      { label: 'Highlight pink', action: 'annot:highlight:pink' },
      { separator: true, label: '' },
      { label: 'Underline', action: 'annot:underline' },
      { label: 'Strikethrough', action: 'annot:strike' },
      { label: 'Add comment…', action: 'annot:comment' },
      { separator: true, label: '' },
      { label: 'Remove selected annotation', action: 'annot:remove' },
      { label: 'Remove all annotations…', action: 'annot:clearAll' }
    ]
  },
  {
    label: 'AI',
    items: [
      { label: 'Ask your documents', action: 'ai:toggle', accelerator: 'Ctrl+Shift+A' },
      { separator: true, label: '' },
      { label: 'Coming soon: documentation from a code project…', action: 'help:featureVote' }
    ]
  },
  {
    label: 'Help',
    items: [
      { label: 'Keyboard shortcuts', action: 'help:shortcuts', accelerator: 'F1' },
      { label: 'Markdown guide', href: 'https://commonmark.org/help/' },
      { separator: true, label: '' },
      { label: 'Request a feature', action: 'help:featureVote' },
      { label: 'Project on GitHub', href: REPO_URL },
      { label: 'Privacy policy', href: PRIVACY_URL },
      { separator: true, label: '' },
      { label: 'About', action: 'help:about' }
    ]
  }
]

interface Props {
  onAction: (action: string) => void
  compact: boolean
}

export default function MenuBar({ onAction, compact }: Props): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const run = (item: MenuItem): void => {
    setOpen(null)
    if (item.href) platform.openExternal(item.href)
    else if (item.action === 'help:featureVote') platform.openExternal(featureRequestUrl())
    else if (item.action) onAction(item.action)
  }

  const dropdown = (menu: Menu): React.JSX.Element => (
    <div className="menu-dropdown" role="menu">
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button key={i} className="menu-item" role="menuitem" onClick={() => run(item)}>
            <span>{item.label}</span>
            {item.accelerator && <span className="menu-accel">{item.accelerator}</span>}
          </button>
        )
      )}
    </div>
  )

  // On a phone a menu bar is unusable; collapse everything behind one button.
  if (compact) {
    return (
      <div className="menubar compact" ref={ref}>
        <button className="menu-title" onClick={() => setOpen(open ? null : 'all')} aria-label="Menu">
          ☰
        </button>
        {open && (
          <div className="menu-dropdown sheet" role="menu">
            {MENUS.map((menu) => (
              <div key={menu.label}>
                <div className="menu-group-label">{menu.label}</div>
                {menu.items
                  .filter((i) => !i.separator)
                  .map((item, i) => (
                    <button key={i} className="menu-item" role="menuitem" onClick={() => run(item)}>
                      <span>{item.label}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="menubar" ref={ref}>
      {MENUS.map((menu) => (
        <div key={menu.label} className="menu-root">
          <button
            className={`menu-title${open === menu.label ? ' on' : ''}`}
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
            onMouseEnter={() => open && setOpen(menu.label)}
          >
            {menu.label}
          </button>
          {open === menu.label && dropdown(menu)}
        </div>
      ))}
    </div>
  )
}
