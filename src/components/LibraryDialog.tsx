import { useCallback, useEffect, useState } from 'react'
import { platform, type SavedDocument } from '../platform'
import { confirmDialog } from '../lib/dialogs'

/**
 * The in-app document library.
 *
 * A browser cannot silently write to a folder on disk, so anything saved
 * without a file handle lives in IndexedDB. This is where the user sees it.
 * On Chrome and Edge desktop most documents will be real files instead, and
 * this stays mostly empty — which is fine.
 */

interface Props {
  onClose: () => void
  onOpen: (id: string) => void
  onToast: (msg: string) => void
}

function ago(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`
  return new Date(timestamp).toLocaleDateString()
}

function size(chars: number): string {
  return chars < 1024 ? `${chars} chars` : `${Math.round(chars / 1024)} KB`
}

export default function LibraryDialog({ onClose, onOpen, onToast }: Props): React.JSX.Element {
  const [docs, setDocs] = useState<SavedDocument[] | null>(null)
  const [filter, setFilter] = useState('')

  const refresh = useCallback(async () => {
    setDocs(await platform.listDocuments())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const remove = async (doc: SavedDocument): Promise<void> => {
    const yes = await confirmDialog({
      title: 'Delete document',
      message: `Delete "${doc.name}"?`,
      detail: 'This removes it from this browser. It cannot be undone.'
    })
    if (!yes) return
    await platform.deleteDocument(doc.id)
    onToast(`Deleted ${doc.name}`)
    await refresh()
  }

  const download = async (doc: SavedDocument): Promise<void> => {
    const full = await platform.loadDocument(doc.id)
    if (full) {
      await platform.exportFile(doc.name, full.content, 'text/markdown')
      onToast(`Downloaded ${doc.name}`)
    }
  }

  const visible = (docs ?? []).filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onClose}>
      <div className="modal library-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>My documents</h3>

        <p className="muted small">
          {platform.capabilities.fileSystemAccess
            ? 'Documents saved without choosing a file are kept in this browser. Use Save as… to write a real file to disk.'
            : 'This browser cannot write files directly, so documents are kept here. Download any you want to keep elsewhere.'}
        </p>

        {docs && docs.length > 4 && (
          <input
            className="library-filter"
            value={filter}
            placeholder="Filter by name"
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        <div className="library-list">
          {docs === null && <p className="muted small">Loading…</p>}

          {docs?.length === 0 && (
            <p className="muted small">
              Nothing saved yet. Documents you save, and anything you convert, will appear here.
            </p>
          )}

          {visible.map((doc) => (
            <div key={doc.id} className="library-row">
              <button className="library-open" onClick={() => onOpen(doc.id)} title={doc.name}>
                <span className="library-name">{doc.name}</span>
                <span className="muted small">
                  {ago(doc.updatedAt)} · {size(doc.size)}
                </span>
              </button>
              <button className="link" onClick={() => download(doc)}>
                Download
              </button>
              <button className="link danger" onClick={() => remove(doc)}>
                Delete
              </button>
            </div>
          ))}

          {docs && docs.length > 0 && visible.length === 0 && (
            <p className="muted small">No documents match “{filter}”.</p>
          )}
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
