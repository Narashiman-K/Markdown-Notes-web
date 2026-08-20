import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { platform } from '../platform'
import { convertToMarkdown, FORMAT_GROUPS, extensionOf, needsOcr, needsTranscription } from '../lib/convert'

/**
 * Converts documents to Markdown.
 *
 * Differs from the desktop version in one structural way: the browser hands us
 * `File` objects rather than paths, and cannot write to an arbitrary folder. So
 * results go into the in-app library, and the user downloads them if they want
 * a copy on disk.
 */

interface QueueItem {
  file: File
  name: string
  ext: string
  isImage: boolean
  isAudio: boolean
  status: 'pending' | 'working' | 'done' | 'error'
  markdown?: string
  error?: string
}

interface Props {
  initialFiles?: File[]
  onClose: () => void
  onOpenResult: (name: string, markdown: string) => void
  onToast: (msg: string) => void
}

const GEMINI_HELP = {
  url: 'https://aistudio.google.com/apikey',
  steps: [
    'Open Google AI Studio and sign in with a Google account.',
    'Click "Create API key", then pick or create a project.',
    'Copy the key and paste it below.'
  ]
}

const ASSEMBLY_HELP = {
  url: 'https://www.assemblyai.com/dashboard/signup',
  pricing: 'https://www.assemblyai.com/pricing',
  steps: [
    'Create an AssemblyAI account — no credit card is required to start.',
    'Open your dashboard home page.',
    'Copy the key shown under "Your API key" and paste it below.'
  ]
}

function KeyPanel({
  title,
  help,
  draft,
  onDraft,
  onCancel,
  onSave
}: {
  title: string
  help: { url: string; steps: string[] }
  draft: string
  onDraft: (v: string) => void
  onCancel: () => void
  onSave: () => void
}): React.JSX.Element {
  return (
    <div className="key-panel">
      <div className="small"><strong>{title}</strong></div>
      <ol className="muted small">
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <button className="link" onClick={() => platform.openExternal(help.url)}>
        Open the sign-up page ↗
      </button>
      <input
        type="password"
        autoFocus
        value={draft}
        placeholder="Paste your API key"
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
      />
      <p className="small muted">
        Encrypted in this browser with a key it will not let scripts read. It never leaves your device
        except to the provider you chose.
      </p>
      <div className="modal-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!draft.trim()} onClick={onSave}>
          Save key
        </button>
      </div>
    </div>
  )
}

export default function ConvertDialog(props: Props): React.JSX.Element {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [finished, setFinished] = useState(false)
  const [ocrMode, setOcrMode] = useState<'cloud' | 'offline'>('cloud')
  const [geminiSaved, setGeminiSaved] = useState(false)
  const [assemblySaved, setAssemblySaved] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [showKeyPanel, setShowKeyPanel] = useState(false)
  const [keyTarget, setKeyTarget] = useState<'gemini' | 'assemblyai'>('gemini')
  const [audioAccepted, setAudioAccepted] = useState(false)
  const seeded = useRef(false)

  const hasImages = useMemo(() => queue.some((q) => q.isImage), [queue])
  const hasAudio = useMemo(() => queue.some((q) => q.isAudio), [queue])
  const doneItems = useMemo(() => queue.filter((q) => q.status === 'done'), [queue])

  const refreshKeys = useCallback(async () => {
    const state = await platform.keyState()
    setGeminiSaved(state.gemini)
    setAssemblySaved(state.assemblyai)
  }, [])

  useEffect(() => {
    void refreshKeys()
  }, [refreshKeys])

  const addFiles = useCallback((files: File[]) => {
    const items: QueueItem[] = files.map((file) => ({
      file,
      name: file.name,
      ext: extensionOf(file.name),
      isImage: needsOcr(file.name),
      isAudio: needsTranscription(file.name),
      status: 'pending'
    }))
    setQueue((q) => [...q, ...items.filter((i) => !q.some((e) => e.name === i.name && e.file.size === i.file.size))])
    setFinished(false)
  }, [])

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (props.initialFiles?.length) addFiles(props.initialFiles)
  }, [props.initialFiles, addFiles])

  const browse = async (): Promise<void> => addFiles(await platform.pickFilesToConvert())

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const saveKey = async (): Promise<void> => {
    if (!keyDraft.trim()) return
    await platform.setKey(keyTarget, keyDraft.trim())
    setKeyDraft('')
    setShowKeyPanel(false)
    await refreshKeys()
    props.onToast(`${keyTarget === 'gemini' ? 'Gemini' : 'AssemblyAI'} key saved and encrypted in this browser.`)
  }

  const openKeyPanel = (target: 'gemini' | 'assemblyai'): void => {
    setKeyTarget(target)
    setKeyDraft('')
    setShowKeyPanel(true)
  }

  const convertAll = async (): Promise<void> => {
    if (!queue.length || busy) return
    if (hasImages && ocrMode === 'cloud' && !geminiSaved) {
      openKeyPanel('gemini')
      props.onToast('Add a Gemini key, or switch to offline OCR.')
      return
    }
    if (hasAudio && !assemblySaved) {
      openKeyPanel('assemblyai')
      props.onToast('Audio needs an AssemblyAI key — it is the one format that cannot run offline.')
      return
    }
    if (hasAudio && !audioAccepted) {
      props.onToast('Tick the box to confirm you understand audio is sent to AssemblyAI.')
      return
    }

    setBusy(true)
    const working = [...queue]

    for (let i = 0; i < working.length; i++) {
      const item = working[i]
      if (item.status === 'done') continue

      working[i] = { ...item, status: 'working' }
      setQueue([...working])
      setProgress(`Reading ${item.name}…`)

      const bytes = await platform.readBytes(item.file)
      const result = await convertToMarkdown(bytes, item.name, {
        ocrMode,
        onProgress: (message) => setProgress(`${item.name}: ${message}`),
        cloudOcr: (b, mimeType) => platform.visionOcr(b, mimeType),
        transcribe: (b) => platform.transcribeAudio(b, (m) => setProgress(`${item.name}: ${m}`))
      })

      working[i] = result.ok
        ? { ...item, status: 'done', markdown: result.markdown }
        : { ...item, status: 'error', error: result.error }
      setQueue([...working])
    }

    setBusy(false)
    setProgress('')
    setFinished(true)

    // Everything converted goes into the library so nothing is lost on reload.
    for (const item of working.filter((w) => w.status === 'done' && w.markdown)) {
      await platform.storeDocument(item.name.replace(/\.[^.]+$/, '') + '.md', item.markdown!)
    }
  }

  const canConvert = queue.some((q) => q.status === 'pending' || q.status === 'error')

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={busy ? undefined : props.onClose}>
      <div className="modal convert-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Convert to Markdown</h3>

        <div className="status-strip good">
          <span className="dot-status" />
          <span>Documents are converted in your browser — nothing is uploaded</span>
        </div>

        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={browse}
          role="button"
          tabIndex={0}
        >
          <div className="dz-icon">⤓</div>
          <div>
            <strong>Drop files here</strong> or tap to browse
          </div>
          <div className="muted small dz-formats">
            <span>Documents: {FORMAT_GROUPS.documents.join(', ')}</span>
            <span>Text &amp; data: {FORMAT_GROUPS.text.slice(0, 12).join(', ')}…</span>
            <span>Images: {FORMAT_GROUPS.images.join(', ')}</span>
            <span>Audio (cloud only): {FORMAT_GROUPS.audio.join(', ')}</span>
          </div>
        </div>

        {hasImages && (
          <div className="ocr-panel">
            <div className="small"><strong>Images detected — how should text be read from them?</strong></div>
            <label className="checkline">
              <input type="radio" name="ocr" checked={ocrMode === 'cloud'} onChange={() => setOcrMode('cloud')} />
              <span className="small">
                <strong>Cloud (Google Gemini)</strong> — more accurate, and describes charts. Sends the image
                to Google. {geminiSaved ? <span className="ok-text">Key saved.</span> : <span className="warn">Needs your API key.</span>}
              </span>
            </label>
            <label className="checkline">
              <input type="radio" name="ocr" checked={ocrMode === 'offline'} onChange={() => setOcrMode('offline')} />
              <span className="small">
                <strong>In this browser</strong> — no key, nothing leaves your device. Good on clear printed
                text, weaker on anything else.
              </span>
            </label>
            {ocrMode === 'cloud' && !geminiSaved && !showKeyPanel && (
              <button className="link" onClick={() => openKeyPanel('gemini')}>
                Add a Gemini API key
              </button>
            )}
            {showKeyPanel && keyTarget === 'gemini' && (
              <KeyPanel
                title="Google Gemini API key"
                help={GEMINI_HELP}
                draft={keyDraft}
                onDraft={setKeyDraft}
                onCancel={() => setShowKeyPanel(false)}
                onSave={saveKey}
              />
            )}
          </div>
        )}

        {hasAudio && (
          <div className="ocr-panel audio-panel">
            <div className="small">
              <strong className="cloud-flag">⚠ Audio transcription is a CLOUD SERVICE ONLY.</strong>
            </div>
            <p className="small muted">
              Every other format is converted inside your browser. Audio is the exception: usable speech
              recognition needs a cloud service. Your audio file is <strong>uploaded to AssemblyAI</strong>.
            </p>
            <p className="small muted">
              AssemblyAI offers a <strong>free tier</strong> with no credit card required. The allowance changes
              from time to time, so check their pricing page before transcribing anything long.
            </p>
            <p className="small muted">
              <strong>Limitations:</strong> needs an internet connection; long files take several minutes;
              accuracy drops with background noise, accents or overlapping speakers.
            </p>
            <button className="link" onClick={() => platform.openExternal(ASSEMBLY_HELP.pricing)}>
              See AssemblyAI's current pricing and free tier ↗
            </button>
            <div className="ai-field-row">
              <span className="small">
                AssemblyAI key: {assemblySaved ? <strong className="ok-text">saved</strong> : <span className="warn">not set</span>}
              </span>
              {!assemblySaved && !showKeyPanel && (
                <button className="link" onClick={() => openKeyPanel('assemblyai')}>
                  Add key
                </button>
              )}
            </div>
            {showKeyPanel && keyTarget === 'assemblyai' && (
              <KeyPanel
                title="AssemblyAI API key"
                help={ASSEMBLY_HELP}
                draft={keyDraft}
                onDraft={setKeyDraft}
                onCancel={() => setShowKeyPanel(false)}
                onSave={saveKey}
              />
            )}
            <label className="checkline">
              <input type="checkbox" checked={audioAccepted} onChange={(e) => setAudioAccepted(e.target.checked)} />
              <span className="small">I understand my audio will be uploaded to AssemblyAI.</span>
            </label>
          </div>
        )}

        {queue.length > 0 && (
          <div className="convert-list">
            {queue.map((q) => (
              <div key={`${q.name}-${q.file.size}`} className={`convert-row ${q.status}`}>
                <span className="badge">{q.ext}</span>
                <span className="cv-name" title={q.name}>
                  {q.name}
                </span>
                <span className="grow" />
                <span className="cv-status small">
                  {q.status === 'working' && 'converting…'}
                  {q.status === 'done' && 'done'}
                  {q.status === 'error' && (
                    <span className="warn" title={q.error}>
                      failed
                    </span>
                  )}
                </span>
                {q.status === 'done' && q.markdown && (
                  <button className="link" onClick={() => props.onOpenResult(q.name, q.markdown!)}>
                    Open
                  </button>
                )}
                {!busy && (
                  <button className="link" onClick={() => setQueue((l) => l.filter((x) => x !== q))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {queue.some((q) => q.status === 'error') && (
              <p className="warn small">{queue.find((q) => q.status === 'error')?.error}</p>
            )}
          </div>
        )}

        {busy && progress && <p className="muted small progress-line">{progress}</p>}

        {finished && doneItems.length > 0 && (
          <div className="result-panel">
            <p>
              Converted {doneItems.length} file{doneItems.length > 1 ? 's' : ''}, saved to your documents.
            </p>
            <div className="modal-actions">
              <button
                onClick={() => {
                  const last = doneItems[doneItems.length - 1]
                  if (last.markdown) {
                    void platform.exportFile(
                      last.name.replace(/\.[^.]+$/, '') + '.md',
                      last.markdown,
                      'text/markdown'
                    )
                  }
                }}
              >
                Download
              </button>
              <button
                className="primary"
                onClick={() => {
                  const last = doneItems[doneItems.length - 1]
                  if (last.markdown) props.onOpenResult(last.name, last.markdown)
                }}
              >
                Open {doneItems.length > 1 ? 'the last one' : 'it'}
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={props.onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" disabled={!canConvert || busy} onClick={convertAll}>
            {busy ? 'Converting…' : `Convert ${queue.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}
