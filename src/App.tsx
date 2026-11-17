import { platform, type OpenDocument, type OpenResult } from './platform'
import type { ProviderId } from './platform/types'
import { basename, confirmDialog, messageDialog, confirmUnsavedDialog } from './lib/dialogs'
import { isNative, isReadableText } from './shared/formats'
import MenuBar from './components/MenuBar'
import LibraryDialog from './components/LibraryDialog'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import Preview, { type PreviewHandle } from './components/Preview'
import Editor, { type EditorHandle } from './components/Editor'
import Sidebar from './components/Sidebar'
import FindBar from './components/FindBar'
import NoteDialog from './components/NoteDialog'
import MindMapView from './components/MindMapView'
import TableEditor, { TableSizePicker } from './components/TableEditor'
import { linesOf, newTable, parseTable, replaceLines, serializeTable, tableAtLine, type Table, type TableRange } from './lib/table'
import AboutDialog from './components/AboutDialog'
import ConvertDialog from './components/ConvertDialog'
import MergeDialog from './components/MergeDialog'
import { normaliseOcrLanguages } from './lib/ocrLanguages'
import {
  annotationSummary,
  describeImport,
  exportAnnotations,
  importAnnotations,
  annotationsNotInFile,
  parseAnnotationsFile
} from './lib/annotationTransfer'
import AiPanel from './components/AiPanel'
import DiffDialog from './components/DiffDialog'
import { analyticsAvailable, analyticsNoticeDue, analyticsOn, commandName, setAnalytics, startAnalytics, track } from './lib/analytics'
import VersionsDialog from './components/VersionsDialog'
import DiagramDialog from './components/DiagramDialog'
import DocEditor, { type DocEditorHandle } from './components/DocEditor'
import { insertAfter } from './lib/docBlocks'
import { undoScope } from './lib/undoScope'
import { installEscapeClose } from './lib/escapeClose'
import { markdownLink, normaliseUrl } from './lib/links'
import AiToolsDialog, { type AiTool } from './components/AiToolsDialog'
import { fetchPageWeb, pickProjectWeb } from './platform/projectFiles'
import { snapshot, versionKey } from './lib/versions'
import { installSignature, signatureComment } from './lib/signature'
import { findQuoteRange, type AiMode } from './lib/aiPrompts'
import { featureRequestUrl } from './shared/brand'
import type { Chunk, SourceDoc } from './lib/retrieval'
import {
  EMPTY_HISTORY,
  canRedo,
  canUndo,
  record,
  redo as redoHistory,
  undo as undoHistory,
  type HistoryState
} from './lib/history'
import { extractHeadings, documentStats, renderMarkdown, standaloneHtml } from './lib/markdown'
import { readPageSize, hasScans, removeScans } from './lib/pages'
import { pickAudiobook, rememberedAudiobook, forgetAudiobook, type WebAudiobook } from './platform/audiobooks'
import { placeToc, refreshToc, hasToc, hasOldPageHeadings, upgradeOldPages } from './lib/toc'
import {
  applyAnnotation,
  listAnnotations,
  removeAnnotation,
  removeAllAnnotations,
  updateNote,
  repairPictures
} from './lib/annotations'
import { wrapSelection, prefixLines, insertBlock, TABLE_SNIPPET, toFileUrl } from './lib/editing'
import { DEFAULT_BLOCK_TINTS, type BlockKind } from './lib/blockTints'
import { linkScrollers, previewScrollTarget, type ScrollSyncTarget } from './lib/syncScroll'
import LivePreview, { type PreviewFormat } from './components/LivePreview'
import ReaderControls from './components/ReaderControls'
import CompareView, { type CompareSource } from './components/CompareView'
import DictationPanel from './components/DictationPanel'
import ReadAloudPanel from './components/ReadAloudPanel'
import { DEFAULT_READ, type ReadOptions } from './lib/speech/readAloud'
import { DEFAULT_DICTATION, type DictationSettings } from './lib/speech/dictation'
import { joinText, DICTATION_LANGUAGES, type DictationAction } from './lib/speech/commands'
import { startTabLink, otherTabs, tabText, setTabText } from './lib/tabLink'
import { convertToMarkdown as convertForCompare } from './lib/convert'
import {
  applyReaderVariables,
  DEFAULT_READER,
  type ReaderSettings
} from './lib/reader'
import { ZOOM_LEVELS, type AnnotationType } from './shared/types'
import { withDiagrams } from './lib/mermaidView'
import markdownCss from './styles/markdown.css?inline'
import hljsCss from 'highlight.js/styles/github.css?inline'

const WELCOME = `# Welcome to Suprasūtā Markdown Notes

A fast Markdown **viewer**, **editor** and **annotator** that runs in your browser.

## Quick start

1. Press **Ctrl+O** to open an existing \`.md\` file.
2. Select any text in view mode to highlight, underline or comment on it.
3. Press **Ctrl+E** to edit the source, then **Ctrl+S** to save and return to view mode.

> Annotations are written straight into the Markdown file as standard HTML
> tags, so the file stays a valid \`.md\` you can open anywhere.

| Shortcut | Action |
| --- | --- |
| Ctrl+O | Open |
| Ctrl+S | Save |
| Ctrl+E | Edit mode |
| Ctrl+P | Print |
| Ctrl+F | Find |
| F1 | All shortcuts |
`

type Mode = 'view' | 'edit'
type SidebarMode = 'none' | 'outline' | 'comments'
type Theme = 'light' | 'dark' | 'system'

/** How often AutoSave runs while there are unsaved changes. */
const AUTOSAVE_MS = 30_000

/** Where dictation's speech models come from (see lib/speech/dictation.ts). */
const DICTATION_HOST = {
  useBrowserCache: true,
  /**
   * Dictated Indian-language text, translated to English by the AI chosen in
   * the AI panel (Ollama: free, offline, nothing leaves the PC).
   */
  translate: async (text: string, language: string): Promise<string> => {
    const name = DICTATION_LANGUAGES.find(([c]) => c === language)?.[1] ?? language
    const s = await platform.getSettings()
    const provider = (s?.aiProvider ?? 'ollama') as ProviderId
    let model: string = s?.aiModel ?? ''
    if (!model) model = (await platform.aiModels(provider))?.models?.[0] ?? ''
    const r = await platform.aiChat({
      provider,
      model,
      system: `Translate the user's ${name} text into natural, fluent English. It is dictated speech, so fix obvious recognition slips from context. Reply with the English translation only: no notes, no quotation marks, no original text.`,
      messages: [{ role: 'user', content: text }],
      temperature: 0,
      maxTokens: 600
    })
    if (!r?.ok) throw new Error(r?.error ?? 'The AI did not answer.')
    return String(r.text ?? '').trim()
  }
}

export default function App(): React.JSX.Element {
  const [content, setContent] = useState(WELCOME)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('Untitled')
  /*
   * Page view: the document on sheets of its original page size. On by itself
   * for a document that recorded one (a converted PDF), until the user says
   * otherwise; the choice lasts until another document is opened.
   */
  const [pageViewChoice, setPageViewChoice] = useState<boolean | null>(null)
  const docHasPages = useMemo(() => readPageSize(content) !== null, [content])
  const pageView = pageViewChoice ?? docHasPages
  // The menu handler is a memoised callback; it reads this, not a stale copy.
  const pageViewRef = useRef(pageView)
  pageViewRef.current = pageView
  /*
   * Scanned pages' own pictures (Convert > Keep each scanned page's picture):
   * shown beside the text to compare, or hidden to see, print and export the
   * converted text alone. Hiding keeps them in the file; Edit > Remove
   * original page pictures takes them out for good.
   */
  const [showScans, setShowScans] = useState(true)
  const docHasScans = useMemo(() => hasScans(content), [content])
  useEffect(() => setPageViewChoice(null), [filePath, fileName])
  const [dirty, setDirty] = useState(false)
  /*
   * AutoSave (File menu, on by default): every 30 seconds while there are
   * unsaved changes, the document is saved the way Save does it without a
   * dialog: back to the file when the browser has permission to write it,
   * otherwise into the document library, where it survives closing the tab.
   */
  const [autosave, setAutosave] = useState(true)
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [zoom, setZoom] = useState(1)
  const [theme, setTheme] = useState<Theme>('system')
  const [systemDark, setSystemDark] = useState(false)
  const [blockTints, setBlockTints] = useState<BlockKind[]>(() => [...DEFAULT_BLOCK_TINTS])
  // Languages offline OCR reads. Remembered: a user with Kannada scans should
  // not have to tick Kannada every time.
  const [ocrLanguages, setOcrLanguages] = useState<string[]>(['eng'])
  const [keepPageImages, setKeepPageImages] = useState(false)
  const [pdfImages, setPdfImages] = useState(true)
  const changePdfImages = useCallback((on: boolean) => {
    setPdfImages(on)
    void platform.setSettings({ pdfImages: on })
  }, [])
  const changeKeepPageImages = useCallback((keep: boolean) => {
    setKeepPageImages(keep)
    void platform.setSettings({ keepPageImages: keep })
  }, [])
  const changeOcrLanguages = useCallback((codes: string[]) => {
    const clean = normaliseOcrLanguages(codes)
    setOcrLanguages(clean)
    void platform.setSettings({ ocrLanguages: clean })
  }, [])
  const [readerOn, setReaderOn] = useState(false)
  const [reader, setReader] = useState<ReaderSettings>(DEFAULT_READER)
  /*
   * State, not refs.
   *
   * A ref object keeps the same identity forever, so an effect depending on
   * one never re-runs when the elements inside are swapped — which happens on
   * every remount and every hot reload. Scroll syncing stayed bound to
   * detached nodes and quietly stopped working. Holding the elements in state
   * makes the effect re-link whenever they actually change.
   */
  const [previewEls, setPreviewEls] = useState<{
    scroller: HTMLDivElement
    body: HTMLElement
  } | null>(null)
  const [editorTarget, setEditorTarget] = useState<ScrollSyncTarget | null>(null)
  const [sidebar, setSidebar] = useState<SidebarMode>('none')
  const [findOpen, setFindOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [toast, setToast] = useState<string | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showDiagram, setShowDiagram] = useState(false)
  // The Doc Editor is on (it shows in place of the View page).
  const [docOn, setDocOn] = useState(false)
  const docOnRef = useRef(false)
  useEffect(() => {
    docOnRef.current = docOn && !readerOn
  })
  const docRef = useRef<DocEditorHandle>(null)
  /** Markdown put after the paragraph being written in the Doc Editor (or at the end). */
  const insertDocMarkdown = (md: string, label: string): void => {
    docRef.current?.commit()
    const line = docRef.current?.insertLine() ?? null
    // Stop the frozen writing view, so the new block shows at once.
    docRef.current?.release()
    setContent((cur) => {
      const next = insertAfter(cur, line === null ? null : { kind: 'text', start: line, end: line, text: '' }, md)
      setHistory((h) => record(h, cur, label))
      return next
    })
    setDirty(true)
  }
  const [aiTool, setAiTool] = useState<AiTool | null>(null)
  const [convertSeed, setConvertSeed] = useState<File[] | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [dictationOpen, setDictationOpen] = useState(false)
  const [readOpen, setReadOpen] = useState(false)
  const [mindOpen, setMindOpen] = useState(false)
  // The reader's own audiobook for this document (linked with the file picker).
  const [audiobook, setAudiobook] = useState<WebAudiobook | null>(null)
  // The chapter map open in it (null: the book overview), and whether the
  // reader left it to look at the document (then a button leads back).
  const [mindFocus, setMindFocus] = useState<string | null>(null)
  const [mindBack, setMindBack] = useState(false)
  // While the mind map is being edited, Undo and Redo act on the map.
  const mindUndo = useRef<((dir: 'undo' | 'redo') => boolean) | null>(null)
  // The table editor: picking a size for a new table, or editing one.
  const [tableDialog, setTableDialog] = useState<
    | { kind: 'size'; from: number; to: number }
    | { kind: 'edit'; table: Table; range: TableRange | null; via: 'edit' | 'view'; from?: number; to?: number }
    | null
  >(null)
  const [readToggle, setReadToggle] = useState(0)
  // The action handler is memoised and does not list these, so it reads
  // them through a ref: otherwise it sees a stale "open" and the toolbar
  // button stops opening the bar after the first open and close.
  const barsOpen = useRef({ read: false, dictation: false })
  const [readOptions, setReadOptions] = useState<ReadOptions>(DEFAULT_READ)
  const [dictationToggle, setDictationToggle] = useState(0)
  const [dictation, setDictation] = useState<DictationSettings>(DEFAULT_DICTATION)
  const [openDoc, setOpenDoc] = useState<OpenDocument | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [appDragging, setAppDragging] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  // A quick action chosen from the AI menu, waiting for the panel to pick it
  // up. Null whenever there is nothing outstanding.
  const [pendingQuick, setPendingQuick] = useState<AiMode | null>(null)
  const [extraDocs, setExtraDocs] = useState<SourceDoc[]>([])
  const [selectionText, setSelectionText] = useState('')
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY)
  const [reviewChanges, setReviewChanges] = useState(true)
  const [pendingDiff, setPendingDiff] = useState<{ next: string; label: string } | null>(null)
  const [dialog, setDialog] = useState<
    | { kind: 'newComment'; range: [number, number] }
    | { kind: 'editNote'; id: string; initial: string }
    | { kind: 'link'; from: number; to: number; view?: boolean }
    | null
  >(null)

  const previewRef = useRef<PreviewHandle>(null)
  const editorRef = useRef<EditorHandle>(null)

  const dark = theme === 'dark' || (theme === 'system' && systemDark)

  /*
   * Reading variables live on the root element, so they have to be re-applied
   * whenever the palette's meaning could change. `auto` resolves against the
   * app's own light or dark state, which is why `dark` is a dependency: the
   * whole point of that setting is that it follows the device.
   */
  useEffect(() => {
    applyReaderVariables(readerOn, reader, dark)
  }, [readerOn, reader, dark])

  // Persisted, but only once the user has actually changed something.
  const changeReader = useCallback((next: ReaderSettings) => {
    setReader(next)
    void platform.setSettings({ reader: next }).catch(() => undefined)
  }, [])


  /*
   * Block tints are read once at startup. A stored value from before this
   * setting existed is undefined rather than an empty array, and those mean
   * opposite things — "never chose" versus "chose none" — so the fallback is
   * only applied when the field is genuinely absent.
   */
  useEffect(() => {
    platform
      .getSettings()
      .then((s) => {
        setBlockTints(s.blockTints ?? [...DEFAULT_BLOCK_TINTS])
        setOcrLanguages(normaliseOcrLanguages(s.ocrLanguages))
        if (typeof s.autosave === 'boolean') setAutosave(s.autosave)
        if (s?.dictation && typeof s.dictation === 'object') {
          const d = s.dictation as Partial<DictationSettings>
          setDictation({ ...DEFAULT_DICTATION, ...d, model: d.model === 'small' ? 'small' : 'base' })
        }
        if (s?.readAloud && typeof s.readAloud === 'object') setReadOptions({ ...DEFAULT_READ, ...(s.readAloud as Partial<ReadOptions>) })
        if (typeof s.pdfImages === 'boolean') setPdfImages(s.pdfImages)
        setKeepPageImages(s.keepPageImages === true)
        if (s.reader) setReader({ ...DEFAULT_READER, ...s.reader })
      })
      .catch(() => undefined)
  }, [])

  /*
   * Join the editor and the live preview once both are on screen.
   *
   * Keyed on `mode` because the split only exists while editing; leaving edit
   * mode unmounts the preview, and a listener left on a detached element would
   * keep it alive. The editor's own view is rebuilt when the theme or zoom
   * changes, so those belong in the dependency list too — the handle would
   * otherwise point at a destroyed CodeMirror.
   */
  useEffect(() => {
    if (mode !== 'edit' || !previewEls || !editorTarget) return
    const { scroller, body } = previewEls

    // Below 1060px the stylesheet hides the preview — there is no room for
    // both panes — and a hidden element measures as zero, so linking to it
    // would feed meaningless offsets back into the editor. Rotating a tablet
    // across that breakpoint will not re-link until the mode is toggled, which
    // is a fair trade for not running a resize listener all session.
    if (scroller.offsetParent === null) return

    return linkScrollers(editorTarget, previewScrollTarget(scroller, body))
    // Both panes are dependencies now. Each reports itself when it is built
    // and withdraws itself when it is torn down, so this re-links whenever
    // either side is replaced rather than relying on a proxy like the theme
    // or the zoom changing at the same time.
  }, [mode, previewEls, editorTarget])
  const headings = useMemo(() => extractHeadings(content), [content])
  const annotations = useMemo(() => listAnnotations(content), [content])
  const stats = useMemo(() => documentStats(content), [content])

  /* ------------------------------------------------------------- helpers */

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600)
  }, [])

  const updateContent = useCallback((next: string, markDirty = true) => {
    setContent(next)
    if (markDirty) setDirty(true)
  }, [])

  /*
   * Formatting applied by selecting in the rendered pane beside the editor.
   *
   * The range arrives as character offsets into the source, worked out from
   * the rendered DOM, so the same edit helpers the editor's own toolbar uses
   * do the work. Going through applyEdit rather than setting the content
   * directly matters: applyEdit reduces this to the smallest change, which
   * keeps undo granular and stops the editor scrolling away from whatever you
   * were looking at.
   */
  const formatFromPreview = useCallback(
    (action: PreviewFormat, [from, to]: [number, number]) => {
      const edit =
        action === 'bold'
          ? wrapSelection(content, from, to, '**')
          : action === 'italic'
            ? wrapSelection(content, from, to, '*')
            : action === 'code'
              ? wrapSelection(content, from, to, '`')
              : action === 'link'
                ? wrapSelection(content, from, to, '[', '](url)')
                : prefixLines(content, from, to, '## ')

      /*
       * The caret is collapsed to the end of the change rather than left
       * selecting it. The editor shows its own floating toolbar whenever a
       * range is selected, so selecting the result meant a second toolbar
       * appeared in the other pane the instant you used the first one.
       */
      editorRef.current?.applyEdit({ ...edit, selectionStart: edit.selectionEnd })
      updateContent(edit.text)
    },
    [content, updateContent]
  )

  /**
   * Applies a change that should be undoable at document level. Typing in the
   * source editor deliberately does NOT go through here — CodeMirror keeps its
   * own fine-grained history for that. This covers annotations and AI edits,
   * which happen outside the editor and would otherwise be irreversible.
   */
  const commitContent = useCallback(
    (next: string, label: string) => {
      setContent((current) => {
        if (current === next) return current
        setHistory((h) => record(h, current, label))
        return next
      })
      setDirty(true)
    },
    []
  )

  /*
   * Compare documents: other tabs can ask this one for its document, and
   * save changes into it (undoable here). The refs keep the answer current
   * without restarting the channel on every keystroke.
   */
  const tabDocRef = useRef({ name: 'Untitled', content: '' })
  tabDocRef.current = { name: fileName, content }
  useEffect(
    () =>
      startTabLink({
        current: () => tabDocRef.current,
        apply: (text, label) => commitContent(text, label)
      }),
    [commitContent]
  )

  /** Where the other side of a comparison can come from, in the browser. */
  const compareSources = useCallback(async (): Promise<CompareSource[]> => {
    const TEXT = ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt', 'text']
    const list: CompareSource[] = [
      {
        id: 'file',
        label: 'Another file…',
        detail: 'Markdown or text, or Word, PDF, PowerPoint, EPUB… (converted first, on this device)',
        load: async () => {
          const [file] = await platform.pickFilesToConvert()
          if (!file) return null
          const bytes = await platform.readBytes(file)
          const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
          let text: string
          if (TEXT.includes(ext)) text = new TextDecoder('utf-8').decode(bytes)
          else {
            const r = await convertForCompare(bytes, file.name, { ocrMode: 'offline', ocrLanguages, keepPageImages })
            if (!r.ok) throw new Error(r.error || `Could not read ${file.name}.`)
            text = r.markdown
          }
          return {
            name: file.name,
            text,
            saveLabel: 'Download edited copy',
            save: async (t) => {
              const base = file.name.replace(/\.[^.]+$/, '')
              await platform.exportFile(`${base}${TEXT.includes(ext) ? `.${ext}` : '.md'}`, t, 'text/markdown')
              return null
            }
          }
        }
      }
    ]
    const doc = openDoc
    if (doc) {
      list.push({
        id: 'saved',
        label: 'The saved version of this document',
        detail: 'What you changed since it was last saved',
        load: async () => {
          const disk = await platform.readOnDisk(doc).catch(() => null)
          if (disk) return { name: `${doc.name} (saved)`, text: disk.content }
          if (doc.id) {
            const stored = await platform.loadDocument(doc.id)
            if (stored) return { name: `${doc.name} (saved)`, text: stored.content }
          }
          throw new Error('There is no saved copy of this document to compare with yet.')
        }
      })
    }
    for (const tab of await otherTabs()) {
      list.push({
        id: `tab:${tab.tabId}`,
        label: tab.name,
        detail: 'Open in another tab',
        load: async () => {
          const got = await tabText(tab.tabId)
          if (!got) throw new Error('That tab did not answer. It may have been closed.')
          return {
            name: got.name,
            text: got.content,
            saveLabel: 'Update that tab',
            save: async (t) => ((await setTabText(tab.tabId, t)) ? null : 'That tab did not answer. It may have been closed.')
          }
        }
      })
    }
    for (const saved of (await platform.listDocuments().catch(() => [])).slice(0, 12)) {
      if (doc?.id && saved.id === doc.id) continue
      list.push({
        id: `lib:${saved.id}`,
        label: saved.name,
        detail: `In My documents · ${new Date(saved.updatedAt).toLocaleString()}`,
        load: async () => {
          const d = await platform.loadDocument(saved.id)
          if (!d) throw new Error(`${saved.name} is no longer in My documents.`)
          return {
            name: d.name,
            text: d.content,
            saveLabel: 'Save to My documents',
            save: async (t) => {
              await platform.storeDocument(d.name, t, saved.id)
              return null
            }
          }
        }
      })
    }
    return list
  }, [openDoc, ocrLanguages, keepPageImages])

  /** Dictated text goes in at the editor's cursor, joined to what precedes it. */
  const applyDictation = useCallback((actions: DictationAction[]) => {
    // The Doc Editor: words go where its caret is.
    if (docOnRef.current && docRef.current) {
      for (const a of actions) {
        if (a.kind === 'undo') document.execCommand('undo')
        else if (a.kind === 'text' && !docRef.current.insertText(a.text)) flash('Click in the text where the words should go, then speak.')
      }
      return
    }
    const editor = editorRef.current
    if (!editor) return
    for (const a of actions) {
      if (a.kind === 'undo') editor.undo()
      else if (a.kind === 'text') {
        const at = editor.getSelection().from
        editor.insertText(joinText(editor.getValue().slice(0, at), a.text))
      }
    }
  }, [])

  const doUndo = useCallback(() => {
    // In edit mode the source editor owns undo, so keystroke-level history
    // still works; fall through to document history when it has nothing left.
    if (mode === 'edit' && editorRef.current?.undo()) return
    setContent((current) => {
      const result = undoHistory(history, current)
      if (!result) {
        flash('Nothing left to undo.')
        return current
      }
      setHistory(result.state)
      setDirty(true)
      flash(`Undid: ${result.label}. Ctrl+Y redoes it.`)
      return result.content
    })
  }, [flash, history, mode])

  const doRedo = useCallback(() => {
    if (mode === 'edit' && editorRef.current?.redo()) return
    setContent((current) => {
      const result = redoHistory(history, current)
      if (!result) {
        flash('Nothing to redo: redo brings back what Undo took away.')
        return current
      }
      setHistory(result.state)
      setDirty(true)
      flash(`Redid: ${result.label}`)
      return result.content
    })
  }, [flash, history, mode])

  // A contents block (Insert > Table of contents) follows the headings:
  // rebuilt on leaving Edit, so the view always shows the current list.
  useEffect(() => {
    if (mode !== 'view' || !hasToc(content)) return
    const fresh = refreshToc(content)
    if (fresh !== content) setContent(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // A document's remembered audiobook (Chrome and Edge remember picked files).
  const audioKey = openDoc?.id ?? fileName
  useEffect(() => {
    setAudiobook(null)
    let live = true
    void rememberedAudiobook(audioKey).then((b) => live && setAudiobook(b))
    return () => {
      live = false
    }
  }, [audioKey])

  const loadDocument = useCallback((path: string | null, text: string) => {
    setAutoSavedAt(null)
    // A picture damaged by an earlier highlight (see repairPictures) is
    // mended on opening; the mended text counts as unsaved until saved.
    const mended = repairPictures(text)
    setContent(mended.source)
    setFilePath(path)
    setDirty(mended.repaired > 0)
    if (mended.repaired) {
      flash(`Repaired ${mended.repaired} picture(s) damaged by an earlier highlight. Save to keep the repair.`)
    }
    // A file converted before 1.3 has a big "## Page 3" heading on every page.
    if (hasOldPageHeadings(mended.source)) {
      void (async () => {
        const yes = await confirmDialog({
          title: 'Tidy up page numbers?',
          message: 'Show the page numbers small, like a footer, and make the contents links work?',
          detail:
            'This file was converted by an earlier version, which put a large "Page 3" heading at the top of every page. ' +
            'They become small grey page numbers at the foot of each page, and the table of contents opens each chapter. ' +
            'Nothing else changes, and you can undo it by not saving.'
        })
        if (!yes) return
        setContent((c) => (c === mended.source ? upgradeOldPages(c) : c))
        setDirty(true)
        flash('Page numbers tidied and contents links added. Save to keep the change.')
      })()
    }
    setMode('view')
    setActiveId(null)
    setHistory(EMPTY_HISTORY)
    setFileName(path ? basename(path) : 'Untitled')
  }, [flash])

  /* ------------------------------------------------------------ file ops */

  /**
   * Handles the three outcomes of opening a path: plain read, "this format
   * must be converted first", and "this opens but would read better
   * converted" (indented .txt, whose indentation Markdown treats as code).
   */
  const handleOpenResult = useCallback(
    async (r: OpenResult) => {
      if (r.canceled) return
      if (!r.ok) {
        if (r.error) flash(r.error)
        return
      }

      // A file that only needs converting does not replace the open document,
      // so there is nothing to lose and nothing to ask about.
      if (r.needsConversion && r.file) {
        setConvertSeed([r.file])
        return
      }
      if (!r.doc) return

      // Only now, when the current document is about to be replaced, is it
      // worth interrupting to ask about unsaved changes.
      if (!(await guardUnsavedRef.current())) return

      setOpenDoc(r.doc)
      loadDocument(r.doc.name, r.doc.content)
      diskStamp.current = 0
      if (r.doc.canSaveInPlace) {
        void platform.readOnDisk(r.doc).then((d) => {
          if (d) diskStamp.current = d.lastModified
        })
      }
      if (r.doc.copyOfFile) {
        flash(
          'This browser opened a copy of the file, without permission to change the original. ' +
            'Your changes are kept in My documents; use File > Save as… to save them to a file.'
        )
      }

      // Indented lines would be read as code blocks, which stops annotations
      // rendering — the same trap the desktop version warns about.
      if (!isNative(r.doc.name) && /^([ ]{4}|\t)\S/m.test(r.doc.content)) {
        const yes = await confirmDialog({
          title: 'Convert to Markdown?',
          message: 'Convert this file to Markdown first?',
          detail:
            'This file contains indented lines. Markdown reads indented text as a code block, ' +
            'which stops highlights and comments from showing up. Converting cleans that up.'
        })
        if (yes && r.doc) {
          setConvertSeed([new File([r.doc.content], r.doc.name, { type: 'text/plain' })])
        }
      }
    },
    [flash, loadDocument]
  )

  const doOpen = useCallback(async () => {
    await handleOpenResult(await platform.openDocument())
  }, [handleOpenResult])

  const doSave = useCallback(
    async (saveAs = false): Promise<boolean> => {
      // The contents block is brought up to date with the headings first.
      const text = refreshToc(content)
      if (text !== content) setContent(text)
      const current: OpenDocument = openDoc ?? {
        id: null,
        name: fileName,
        content: text,
        canSaveInPlace: false
      }
      const r = saveAs
        ? await platform.saveDocumentAs(current, text)
        : await platform.saveDocument(current, text)

      if (r.canceled) return false
      if (r.ok && r.doc) {
        setOpenDoc(r.doc)
        setFileName(r.doc.name)
        setDirty(false)
        void snapshot(versionKey(r.doc), text)
        // What is on disk now is ours: changes after this are someone else's.
        const saved = r.doc
        void platform.readOnDisk(saved).then((d) => {
          if (d) diskStamp.current = d.lastModified
        })
        // Stay where you are. Saving used to switch to View mode, so after
        // every save you had to go back to Edit and find your place again.
        flash(
          r.doc.canSaveInPlace
            ? `Saved ${r.doc.name}`
            : `Saved ${r.doc.name} to your documents`
        )
        return true
      }
      if (r.error) flash(`Could not save: ${r.error}`)
      return false
    },
    [content, fileName, flash, openDoc]
  )

  const guardUnsaved = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    const choice = await confirmUnsavedDialog(fileName)
    if (choice === 'cancel') return false
    if (choice === 'save') return doSave(false)
    return true
  }, [dirty, doSave, fileName])

  const doNew = useCallback(async () => {
    if (!(await guardUnsaved())) return
    loadDocument(null, '# Untitled\n\n')
    setMode('edit')
  }, [guardUnsaved, loadDocument])

  const buildStandalone = useCallback(
    (forPrint: boolean) =>
      signatureComment() +
      '\n' +
      standaloneHtml(
        fileName,
        // Printed and exported as shown: without the page pictures while they are hidden.
        withDiagrams(renderMarkdown(content, { hideScans: !showScans })),
        `${markdownCss}\n${hljsCss}`,
        forPrint,
        readPageSize(content)
      ),
    [content, fileName, showScans]
  )

  /* ----------------------------------------------------------- annotate */

  const annotate = useCallback(
    (type: AnnotationType, color?: string, note?: string, range?: [number, number]) => {
      const r = range ?? previewRef.current?.getSelectionRange()
      if (!r) {
        flash('Select some text in view mode first.')
        return
      }
      const author = undefined
      const result = applyAnnotation(content, r[0], r[1], { type, color, note, author })
      if (result.applied === 0) {
        flash('That selection cannot be annotated (code blocks are skipped).')
        return
      }
      commitContent(result.source, `Add ${type}`)
      setActiveId(result.id)
      previewRef.current?.clearSelection()
    },
    [commitContent, content, flash]
  )

  const doRemove = useCallback(
    (id: string) => {
      commitContent(removeAnnotation(content, id), 'Remove annotation')
      setActiveId(null)
    },
    [commitContent, content]
  )

  /* ----------------------------------------------------------------- AI */

  /** Places AI-suggested annotations by locating each quote in the source. */
  const applyAiAnnotations = useCallback(
    (items: Array<{ quote: string; type: string; color?: string; note?: string }>) => {
      let next = content
      let placed = 0
      const missed: string[] = []

      // Apply from the end of the document backwards so earlier offsets stay valid.
      const located = items
        .map((item) => ({ item, range: findQuoteRange(next, item.quote) }))
        .filter((entry): entry is { item: typeof entry.item; range: [number, number] } => {
          if (!entry.range) missed.push(entry.item.quote.slice(0, 40))
          return entry.range !== null
        })
        .sort((a, b) => b.range[0] - a.range[0])

      for (const { item, range } of located) {
        const result = applyAnnotation(next, range[0], range[1], {
          type: item.type as AnnotationType,
          color: item.color,
          note: item.note,
          author: 'AI'
        })
        if (result.applied > 0) {
          next = result.source
          placed++
        } else {
          missed.push(item.quote.slice(0, 40))
        }
      }

      if (!placed) {
        flash('None of the suggested passages could be matched in the document.')
        return
      }
      commitContent(next, `AI annotations (${placed})`)
      setSidebar('comments')
      flash(
        missed.length
          ? `Added ${placed} annotation${placed === 1 ? '' : 's'}; ${missed.length} could not be matched.`
          : `Added ${placed} annotation${placed === 1 ? '' : 's'}.`
      )
    },
    [commitContent, content, flash]
  )

  const applyAiRevision = useCallback(
    (next: string, label: string) => {
      if (next.trim() === content.trim()) {
        flash('The AI returned the document unchanged.')
        return
      }
      if (reviewChanges) setPendingDiff({ next, label })
      else {
        commitContent(next, label)
        flash(`${label} applied. Ctrl+Z to undo.`)
      }
    },
    [commitContent, content, flash, reviewChanges]
  )

  const addContextDocuments = useCallback(async () => {
    const files = await platform.pickFilesToConvert()
    const added: SourceDoc[] = []
    for (const file of files) {
      if (isReadableText(file.name)) {
        added.push({ id: file.name, name: file.name, content: await file.text() })
      } else {
        flash(`${file.name} must be converted to Markdown first (Ctrl+Shift+M).`)
      }
    }
    if (added.length) {
      setExtraDocs((docs) => [...docs, ...added.filter((a) => !docs.some((d) => d.id === a.id))])
      flash(`Added ${added.length} document${added.length === 1 ? '' : 's'} to the AI context.`)
    }
  }, [flash])

  const jumpToChunk = useCallback((chunk: Chunk) => {
    setMode('view')
    window.setTimeout(() => {
      const found = previewRef.current?.scrollToText(chunk.text)
      if (!found) previewRef.current?.scrollToSlug(chunk.heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'))
    }, 60)
  }, [])

  /* ----------------------------------------------------- source editing */

  /** Rewrites one table in Edit mode, through the editor so undo works there. */
  const editTableInEditor = useCallback((line: number, change: (t: Table) => Table) => {
    const ed = editorRef.current
    if (!ed) return
    const text = ed.getValue()
    const range = tableAtLine(text, line)
    const table = range ? parseTable(linesOf(text, range)) : null
    if (!range || !table) return
    const { from } = ed.getSelection()
    const next = replaceLines(text, range, serializeTable(change(table)))
    const at = Math.min(from, next.length)
    ed.applyEdit({ text: next, selectionStart: at, selectionEnd: at })
  }, [])

  const editorEdit = useCallback(
    (fn: (text: string, from: number, to: number) => ReturnType<typeof wrapSelection>) => {
      if (mode !== 'edit' || !editorRef.current) {
        flash('Switch to Edit mode (Ctrl+E) to use this.')
        return
      }
      const { from, to } = editorRef.current.getSelection()
      editorRef.current.applyEdit(fn(editorRef.current.getValue(), from, to))
    },
    [flash, mode]
  )

  /* ------------------------------------------------------- menu actions */

  /** Saves (downloads) this document's annotations as name.annotations.json. */
  const saveAnnotationsFile = useCallback(async (): Promise<void> => {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/-clean$/, '')
    await platform.exportFile(
      `${base}.annotations.json`,
      JSON.stringify(exportAnnotations(content, fileName), null, 2),
      'application/json'
    )
    flash('Annotations saved. Load them onto any copy with File > Load annotations…')
  }, [content, fileName, flash])

  const handleAction = useCallback(
    async (action: string, payload?: unknown) => {
      // Usage counts: the command's name only, never its argument.
      const cmd = commandName(action)
      if (cmd) track('command', { name: cmd })
      // The Insert menu acts in the Doc Editor too (headings, lists, table, code…).
      if (docOnRef.current && action.startsWith('insert:') && docRef.current?.run(action)) return
      if (action.startsWith('ai:tool:')) {
        setAiTool(action.slice(8) as AiTool)
        return
      }
      switch (action) {
        case 'file:autosave': {
          const next = !autosaveRef.current
          setAutosave(next)
          void platform.setSettings({ autosave: next })
          flash(next ? 'AutoSave on: changes are saved every 30 seconds.' : 'AutoSave off: press Save to keep your changes.')
          return
        }
        case 'file:new':
          return doNew()
        case 'file:open':
          return doOpen()
        case 'file:openPath': {
          // On the web there are no paths; this carries a library document id.
          const doc = await platform.loadDocument(String(payload))
          if (doc) {
            if (!(await guardUnsavedRef.current())) return
            setOpenDoc(doc)
            loadDocument(doc.name, doc.content)
          } else {
            flash('That document is no longer in your library.')
          }
          return
        }
        case 'file:library':
          setShowLibrary(true)
          return
        case 'convert:open':
          setConvertSeed([])
          return
        case 'file:merge':
          setMergeOpen(true)
          return
        case 'file:compare':
          setCompareOpen(true)
          return
        case 'view:mindmap':
          setMindBack(false)
          setMindOpen((o) => !o)
          return
        case 'view:readAloud':
          // Reads the rendered page, so it needs View (or Reader) mode.
          if (barsOpen.current.read) setReadOpen(false)
          else {
            setMode('view')
            setReadOpen(true)
          }
          return
        case 'view:readAloud:play':
          setMode('view')
          if (barsOpen.current.read) setReadToggle((n) => n + 1)
          else setReadOpen(true)
          return
        case 'edit:dictateBar':
          // The toolbar button opens and closes the bar.
          if (barsOpen.current.dictation) setDictationOpen(false)
          else {
            // The Doc Editor takes dictation itself; otherwise the Markdown editor does.
            if (!docOnRef.current) setMode('edit')
            setDictationOpen(true)
          }
          return
        case 'edit:dictate':
          // Dictation types at the editor's cursor (or the Doc Editor's).
          if (!docOnRef.current) setMode('edit')
          if (barsOpen.current.dictation) setDictationToggle((n) => n + 1)
          else setDictationOpen(true)
          return
        case 'ai:toggle':
          setAiOpen((v) => !v)
          return
        case 'ai:quick:summarise':
        case 'ai:quick:compare':
        case 'ai:quick:explain':
        case 'ai:quick:annotate':
          /*
           * Open the panel and hand it the action. Opening is unconditional
           * rather than a toggle: choosing "Summarise" from a menu is a request
           * to see the answer, and toggling would close the panel it is about
           * to write into.
           */
          setAiOpen(true)
          setPendingQuick(action.slice('ai:quick:'.length) as AiMode)
          return
        case 'edit:undo':
        case 'edit:redo': {
          const dir = action === 'edit:undo' ? 'undo' : 'redo'
          // A popup with its own history (the table editor) first.
          if (undoScope.current) {
            undoScope.current(dir)
            return
          }
          // Doc Editor: typing is saved into the document as you go, so Undo and
          // Redo walk the document's history (the words typed since the last pause first).
          if (docOnRef.current && !document.activeElement?.closest('.modal')) {
            if (docRef.current?.pending()) {
              docRef.current.commit()
              window.setTimeout(() => void actionRef.current(action), 40)
              return
            }
            docRef.current?.release()
            if (dir === 'undo') doUndo()
            else doRedo()
            return
          }
          // Typing in a box of a dialog: the box's own undo.
          const box = document.activeElement as HTMLElement | null
          if (box && !box.closest('.cm-editor') && (box.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(box.tagName) && box.closest('.modal')))) {
            document.execCommand(dir)
            return
          }
          if (mindUndo.current) {
            // Typing in a box on the map: the box's own undo.
            const el = document.activeElement as HTMLElement | null
            if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) document.execCommand(dir)
            else mindUndo.current(dir)
            return
          }
          if (dir === 'undo') doUndo()
          else doRedo()
          return
        }
        case 'convert:settings':
          setConvertSeed((s) => s ?? [])
          return
        case 'file:save':
          // Doc Editor: what is being typed goes into the document first.
          if (docOn && docRef.current?.pending()) {
            docRef.current.commit()
            window.setTimeout(() => void actionRef.current('file:save'), 30)
            return
          }
          await doSave(false)
          return
        case 'file:saveAs':
          await doSave(true)
          return
        case 'file:versions':
          setShowVersions(true)
          return
        case 'file:export:html': {
          const base = fileName.replace(/\.[^.]+$/, '')
          await platform.exportFile(`${base}.html`, buildStandalone(false), 'text/html')
          flash('HTML downloaded.')
          return
        }
        case 'file:export:pdf':
          // Browsers have no "save as PDF" API; the print dialog offers it as a
          // destination, which is the standard way to do this on the web.
          await platform.print(buildStandalone(true))
          flash('Choose "Save as PDF" as the destination in the print dialog.')
          return
        case 'file:export:clean': {
          const base = fileName.replace(/\.[^.]+$/, '')
          await platform.exportFile(`${base}-clean.md`, removeAllAnnotations(content), 'text/markdown')
          flash('Clean Markdown downloaded.')
          // Offer to keep the annotations, ready for File > Load annotations….
          if (
            annotations.length &&
            window.confirm(
              `Save this document's ${annotations.length} annotation${annotations.length === 1 ? '' : 's'} in a separate file?\n\n` +
                'An annotations file (.annotations.json) can be loaded back onto the clean copy, or any copy of this ' +
                'document, with File > Load annotations…, and they land on the same words.'
            )
          ) {
            await saveAnnotationsFile()
          }
          return
        }
        case 'file:export:annotations':
          if (!annotations.length) {
            flash('This document has no annotations to export.')
            return
          }
          await saveAnnotationsFile()
          return
        case 'file:export:annotationSummary': {
          if (!annotations.length) {
            flash('This document has no annotations to summarise.')
            return
          }
          const base2 = fileName.replace(/\.[^.]+$/, '')
          await platform.exportFile(`${base2} - annotations.md`, annotationSummary(exportAnnotations(content, fileName)), 'text/markdown')
          flash('Annotation summary downloaded.')
          return
        }
        case 'file:importAnnotations': {
          let picked: { name: string; content: string } | null = null
          try {
            picked = await platform.pickTextFile('.json,application/json')
          } catch (err) {
            flash(String((err as Error).message ?? err))
            return
          }
          if (!picked) return
          let file
          try {
            file = parseAnnotationsFile(picked.content)
          } catch (err) {
            flash(String((err as Error).message ?? err))
            return
          }
          const extras = annotationsNotInFile(content, file)
          const replace =
            extras.length > 0 &&
            window.confirm(
              `This document has ${extras.length} annotation${extras.length === 1 ? '' : 's'} that ${extras.length === 1 ? 'is' : 'are'} not in ${picked.name}:\n\n` +
                extras
                  .slice(0, 8)
                  .map((x) => `• “${x.text.replace(/\s+/g, ' ').trim().slice(0, 70)}”`)
                  .join('\n') +
                (extras.length > 8 ? `\n…and ${extras.length - 8} more` : '') +
                '\n\nOK: remove them, so the annotations are exactly the file\'s.\nCancel: keep them, and only add what the file has.'
            )
          const r = importAnnotations(content, file, { replace })
          if (r.placed || r.removed) commitContent(r.source, `Load annotations (${r.placed} added${r.removed ? `, ${r.removed} removed` : ''})`)
          const { summary, detail } = describeImport(r, picked.name)
          if (detail) window.alert(`${summary}\n\n${detail}`)
          else flash(summary)
          return
        }
        case 'file:print':
          await platform.print(buildStandalone(true))
          return
        /*
         * The browser has no menu roles, so these are implemented here.
         * Select all has to know about the editor: the document-wide command
         * would select the page rather than the source being edited.
         */
        case 'edit:selectAll':
          if (mode === 'edit') editorRef.current?.selectAll()
          else document.execCommand('selectAll')
          return

        case 'edit:cut':
        case 'edit:copy':
          document.execCommand(action === 'edit:cut' ? 'cut' : 'copy')
          return

        case 'edit:paste':
          /*
           * Chromium refuses document.execCommand('paste'), so the clipboard
           * is read through the async API. It needs a secure context and the
           * user's permission, and can be refused - in which case nothing
           * happens rather than something wrong.
           */
          try {
            const text = await navigator.clipboard.readText()
            if (text && mode === 'edit') editorRef.current?.insertText(text)
            else if (text) flash('Switch to edit mode to paste')
          } catch {
            flash('Your browser blocked reading the clipboard. Use Ctrl+V.')
          }
          return

        case 'edit:find':
          if (mode === 'view') setFindOpen(true)
          else editorRef.current?.focus()
          return

        case 'view:scans':
          setShowScans((v) => !v)
          break
        case 'edit:removeScans': {
          const { markdown, removed } = removeScans(content)
          if (!removed) {
            flash('This document has no original page pictures.')
            break
          }
          commitContent(markdown, 'Remove original page pictures')
          setShowScans(true)
          flash(`Removed ${removed} original page picture${removed === 1 ? '' : 's'}. Ctrl+Z puts them back.`)
          break
        }
        case 'view:pages':
          setPageViewChoice(!pageViewRef.current)
          break
        case 'view:reader':
          /*
           * Reading implies view mode. Entering it from the editor and
           * leaving the source visible underneath would be a mode within a
           * mode, and the chrome that gets hidden includes the editor's own.
           */
          setMode('view')
          setReaderOn((on) => !on)
          return

        /*
         * Choosing a mode explicitly leaves reader mode.
         *
         * Without this, picking View while already reading did nothing
         * visible - it was already in view mode - so the only way out was the
         * reader toggle itself, which is not where anyone looks.
         */
        case 'view:mode:view':
          setReaderOn(false)
          setDocOn(false)
          setMode('view')
          return
        case 'view:mode:edit':
          setReaderOn(false)
          setDocOn(false)
          setMode('edit')
          return
        case 'view:mode:doc':
          // Doc Editor: write formatted text; the file stays Markdown (components/DocEditor.tsx).
          setReaderOn(false)
          setMode('view')
          setDocOn(true)
          return
        case 'view:zoom:in':
          setZoom((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.findIndex((v) => v >= z) + 1)] ?? z)
          return
        case 'view:zoom:out':
          setZoom((z) => {
            const i = ZOOM_LEVELS.findIndex((v) => v >= z)
            return ZOOM_LEVELS[Math.max(0, (i === -1 ? ZOOM_LEVELS.length - 1 : i) - 1)]
          })
          return
        case 'view:zoom:reset':
          setZoom(1)
          return
        case 'view:sidebar:outline':
          setSidebar((s) => (s === 'outline' ? 'none' : 'outline'))
          return
        case 'view:sidebar:comments':
          setSidebar((s) => (s === 'comments' ? 'none' : 'comments'))
          return
        case 'view:theme:light':
          setTheme('light')
          return
        case 'view:theme:dark':
          setTheme('dark')
          return
        case 'view:theme:system':
          setTheme('system')
          return

        case 'annot:highlight:yellow':
          return annotate('highlight', 'yellow')
        case 'annot:highlight:green':
          return annotate('highlight', 'green')
        case 'annot:highlight:blue':
          return annotate('highlight', 'blue')
        case 'annot:highlight:pink':
          return annotate('highlight', 'pink')
        case 'annot:underline':
          return annotate('underline')
        case 'annot:strike':
          return annotate('strike')
        case 'annot:bold':
          return annotate('bold')
        case 'annot:comment': {
          const r = previewRef.current?.getSelectionRange()
          if (!r) {
            flash('Select some text in view mode first.')
            return
          }
          setDialog({ kind: 'newComment', range: r })
          return
        }
        case 'annot:remove':
          if (activeId) doRemove(activeId)
          else flash('Click an annotation first, then remove it.')
          return
        case 'annot:clearAll': {
          const ok = await confirmDialog({
            title: 'Remove all annotations',
            message: `Remove all ${annotations.length} annotations from this document?`,
            detail: 'The underlying text is kept. This can be undone with Ctrl+Z in edit mode only after saving.'
          })
          if (ok) {
            commitContent(removeAllAnnotations(content), 'Remove all annotations')
            setActiveId(null)
            flash('All annotations removed.')
          }
          return
        }

        case 'insert:bold':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '**'))
        case 'insert:italic':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '*'))
        case 'insert:code':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '`'))
        case 'insert:strike':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '~~'))
        case 'insert:codeblock':
          return editorEdit((t, f, to) => {
            const sel = t.slice(f, to)
            const block = '```\n' + (sel || 'code here') + '\n```'
            const needsLead = f > 0 && t[f - 1] !== '\n'
            const body = (needsLead ? '\n\n' : '') + block + '\n'
            return { text: t.slice(0, f) + body + t.slice(to), selectionStart: f, selectionEnd: f + body.length }
          })
        case 'insert:h1':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '# '))
        case 'insert:h2':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '## '))
        case 'insert:h3':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '### '))
        case 'insert:ul':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '- '))
        case 'insert:ol':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '1. ', true))
        case 'insert:task':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '- [ ] '))
        case 'insert:quote':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '> '))
        case 'insert:hr':
          return editorEdit((t, f, to) => insertBlock(t, f, to, '---'))
        case 'insert:table': {
          // In a table: edit it. Elsewhere: pick a size, then fill it in.
          if (mode !== 'edit' || !editorRef.current) {
            flash('Switch to Edit mode (Ctrl+E) to place a new table. To change a table, point at it and choose ✎ Edit table.')
            return
          }
          const text = editorRef.current.getValue()
          const { from, to } = editorRef.current.getSelection()
          const range = tableAtLine(text, text.slice(0, from).split('\n').length - 1)
          const table = range ? parseTable(linesOf(text, range)) : null
          if (range && table) setTableDialog({ kind: 'edit', table, range, via: 'edit' })
          else setTableDialog({ kind: 'size', from, to })
          return
        }
        case 'insert:diagram':
          setShowDiagram(true)
          return
        case 'insert:toc': {
          // Updates the book's own contents, or the one already added; never a second one.
          const r = placeToc(content)
          if (r.text === content) {
            flash('The table of contents is already up to date.')
            return
          }
          commitContent(r.text, r.updated ? 'Update table of contents' : 'Insert table of contents')
          flash(r.where === 'section' ? 'The book’s table of contents is updated in place: every entry links to its chapter. Ctrl+Z to undo.' : r.where === 'block' ? 'Table of contents updated.' : 'Table of contents added before the first chapter. It updates itself when you save. Ctrl+Z to undo.')
          return
        }
        case 'insert:link': {
          // View mode: the selected text on the page; Edit mode: the editor's selection.
          if (mode !== 'edit' || !editorRef.current) {
            const r = previewRef.current?.getSelectionRange()
            if (!r) {
              flash('Select the words to turn into a link first, then choose Link (or press Ctrl+K).')
              return
            }
            setDialog({ kind: 'link', from: r[0], to: r[1], view: true })
            return
          }
          const sel = editorRef.current.getSelection()
          setDialog({ kind: 'link', from: sel.from, to: sel.to })
          return
        }
        case 'insert:image': {
          if (mode !== 'edit' && !docOn) {
            flash('Switch to Edit mode (Ctrl+E) to insert an image.')
            return
          }
          const [image] = await platform.pickFilesToConvert()
          if (!image) return
          // A browser cannot reference a local path, so the image is embedded.
          // That keeps the Markdown self-contained and portable.
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.readAsDataURL(image)
          })
          const alt = image.name.replace(/\.[^.]+$/, '')
          if (docOn) {
            insertDocMarkdown(`![${alt}](${dataUrl})`, 'Insert picture')
            return
          }
          editorEdit((t, f, to) => {
            const inserted = `![${alt}](${dataUrl})`
            return { text: t.slice(0, f) + inserted + t.slice(to), selectionStart: f, selectionEnd: f + inserted.length }
          })
          flash('Image embedded in the document.')
          return
        }

        case 'help:about':
          setShowAbout(true)
          return
        case 'help:analytics': {
          const next = !analyticsOn()
          setAnalytics(next)
          flash(
            !next
              ? 'Usage statistics off: nothing is sent.'
              : analyticsAvailable()
                ? 'Anonymous usage statistics on: only which features are used, never what you write.'
                : 'Usage statistics on. (This test build has no statistics key yet, so nothing is actually sent.)'
          )
          return
        }
        case 'help:featureVote':
          platform.openExternal(featureRequestUrl())
          flash('Opening GitHub — your vote helps decide what gets built next.')
          return
        case 'help:shortcuts':
          await messageDialog({
            title: 'Keyboard shortcuts',
            message: 'Suprasūtā Markdown Notes shortcuts',
            detail: [
              'Ctrl+N  New          Ctrl+O  Open',
              'Ctrl+S  Save         Ctrl+Shift+S  Save As',
              'Ctrl+P  Print        Ctrl+F  Find',
              'Ctrl+E  Edit mode    Ctrl+Shift+V  View mode',
              'Ctrl +/-/0  Zoom     Ctrl+Shift+O  Outline',
              'Ctrl+Shift+C  Annotations panel',
              '',
              'Annotate (view mode, with text selected):',
              'Ctrl+Alt+1..4  Highlight yellow/green/blue/pink',
              'Ctrl+U  Underline    Ctrl+Shift+X  Strikethrough',
              'Ctrl+Alt+M  Add comment',
              'Ctrl+Alt+Backspace  Remove selected annotation'
            ].join('\n')
          })
          return
      }
    },
    [
      activeId,
      annotate,
      annotations.length,
      saveAnnotationsFile,
      buildStandalone,
      commitContent,
      content,
      doNew,
      doOpen,
      doRedo,
      doRemove,
      doSave,
      doUndo,
      editorEdit,
      fileName,
      flash,
      guardUnsaved,
      handleOpenResult,
      mode,
      updateContent
    ]
  )

  barsOpen.current = { read: readOpen, dictation: dictationOpen }
  const actionRef = useRef(handleAction)
  // Alt+M opens and closes the mind map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        void actionRef.current('view:mindmap')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  actionRef.current = handleAction

  // The AI tools' link to whichever AI is set up in the AI panel.
  const aiBridge = useMemo(
    () => ({
      status: async () => {
        const s = await platform.getSettings()
        return platform.aiStatus((s?.aiProvider ?? 'ollama') as ProviderId)
      },
      ask: async (system: string, user: string) => {
        const s = await platform.getSettings()
        const provider = (s?.aiProvider ?? 'ollama') as ProviderId
        let model: string = s?.aiModel ?? ''
        if (!model) model = (await platform.aiModels(provider))?.models?.[0] ?? ''
        return platform.aiChat({ provider, model, system, messages: [{ role: 'user', content: user }], temperature: 0.2, maxTokens: 2000 })
      }
    }),
    []
  )

  // Esc closes whichever popup is in front (lib/escapeClose.ts).
  useEffect(() => installEscapeClose(), [])

  // Anonymous usage statistics (see lib/analytics.ts), with a one-time notice.
  useEffect(() => {
    startAnalytics('web', __APP_VERSION__)
    if (analyticsNoticeDue())
      flash('Anonymous usage counts help improve the app; nothing you write is sent. Turn off: Help → Send anonymous usage statistics.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------- effects */

  useEffect(() => {
    platform.getSettings().then((s) => {
      if (s?.theme) setTheme(s.theme)
      if (s?.zoom) setZoom(s.zoom)
      if (typeof s?.aiReviewChanges === 'boolean') setReviewChanges(s.aiReviewChanges)
    })

    // Track the current selection so the AI panel can explain it.
    const onSel = (): void => {
      const text = window.getSelection()?.toString() ?? ''
      setSelectionText(text.trim().length > 2 ? text.trim() : '')
    }
    document.addEventListener('selectionchange', onSel)

    // The desktop build was told about theme changes over IPC; a browser
    // reports them directly.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(media.matches)
    const onScheme = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    media.addEventListener('change', onScheme)

    /**
     * Keyboard shortcuts.
     *
     * These came free from the native menu on Windows. In a browser every one
     * has to be claimed explicitly, and several (Ctrl+O, Ctrl+S, Ctrl+P) would
     * otherwise trigger the browser's own behaviour instead of ours.
     */
    const onKey = (e: KeyboardEvent): void => {
      // Already handled where it happened (the editor's own undo and redo, a
      // dialog's keys): acting again here undid twice and lost the redo.
      if (e.defaultPrevented) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) {
        /*
       * F9, not Ctrl+Shift+R.
       *
       * Ctrl+Shift+R is the browser's hard-reload shortcut and is swallowed
       * before the page ever sees it, so reader mode was unreachable by
       * keyboard in the browser build. F9 is free in both, and the two builds
       * should not disagree about a shortcut.
       */
      if (e.key === 'F9') {
        e.preventDefault()
        void actionRef.current('view:reader')
        return
      }

      if (e.key === 'F1') {
          e.preventDefault()
          void actionRef.current('help:shortcuts')
        }
        return
      }

      const key = e.key.toLowerCase()
      const shift = e.shiftKey
      const map: Record<string, string> = {
        n: 'file:new',
        o: 'file:open',
        s: shift ? 'file:saveAs' : 'file:save',
        p: 'file:print',
        f: 'edit:find',
        e: 'view:mode:edit',
        z: shift ? 'edit:redo' : 'edit:undo',
        y: 'edit:redo',
        '=': 'view:zoom:in',
        '+': 'view:zoom:in',
        '-': 'view:zoom:out',
        '0': 'view:zoom:reset',
        m: shift ? 'convert:open' : '',
        a: shift ? 'ai:toggle' : '',
        d: shift ? 'edit:dictate' : '',
        ' ': shift ? 'view:readAloud:play' : '',
        v: shift ? 'view:mode:view' : '',
        o_shift: 'view:sidebar:outline',
        c: shift ? 'view:sidebar:comments' : '',
        k: shift ? '' : 'insert:link'
      }

      let action = shift && key === 'o' ? 'view:sidebar:outline' : map[key]
      if (shift && key === 'o') action = 'view:sidebar:outline'
      if (!action) return

      // Never swallow copy, cut, paste or select-all.
      if (!shift && ['c', 'v', 'x', 'a'].includes(key)) return

      e.preventDefault()
      void actionRef.current(action)
    }
    window.addEventListener('keydown', onKey)

    /** Warn before closing the tab with unsaved work. */
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      document.removeEventListener('selectionchange', onSel)
      media.removeEventListener('change', onScheme)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flash, loadDocument])

  const guardUnsavedRef = useRef(guardUnsaved)
  guardUnsavedRef.current = guardUnsaved
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  /* ------------------------------------------------------------ AutoSave */

  const autosaveRef = useRef(autosave)
  autosaveRef.current = autosave
  const latestDoc = useRef({ content, openDoc, fileName })
  latestDoc.current = { content, openDoc, fileName }
  const autosaveTimer = useRef<number | null>(null)

  const runAutosave = useCallback(async () => {
    if (!dirtyRef.current || !autosaveRef.current) return
    const { content: text, openDoc: doc, fileName: name } = latestDoc.current
    const current: OpenDocument = doc ?? { id: null, name, content: text, canSaveInPlace: false }
    if (conflictOpen.current) return
    const r = await platform.saveDocument(current, text)
    if (r.ok && r.doc) {
      setOpenDoc(r.doc)
      if (latestDoc.current.content === text) setDirty(false)
      setAutoSavedAt(new Date())
      const d = await platform.readOnDisk(r.doc)
      if (d) diskStamp.current = d.lastModified
    }
  }, [])

  /*
   * Changes made to the file outside the browser (the Windows app, another
   * editor). A browser cannot watch a file, so it is read again whenever the
   * tab comes back into view. Unchanged here: the new version is loaded.
   * Changed here too: the user chooses, and AutoSave waits for the answer
   * rather than overwrite the other version.
   */
  const diskStamp = useRef(0)
  const conflictOpen = useRef(false)
  useEffect(() => {
    const check = (): void => {
      if (document.visibilityState !== 'visible') return
      const doc = latestDoc.current.openDoc
      if (!doc?.canSaveInPlace || conflictOpen.current) return
      void platform.readOnDisk(doc).then((d) => {
        if (!d || !diskStamp.current || d.lastModified <= diskStamp.current) return
        if (d.content === latestDoc.current.content) {
          diskStamp.current = d.lastModified
          return
        }
        if (!dirtyRef.current) {
          diskStamp.current = d.lastModified
          setContent(d.content)
          flash('Updated: the file was changed outside this app.')
          return
        }
        conflictOpen.current = true
        const loadTheirs = window.confirm(
          `“${doc.name}” was changed outside this app while you have unsaved changes here.\n\n` +
            'OK: load the changed file (your changes here are discarded).\n' +
            'Cancel: keep your version (saving will replace the other one).'
        )
        diskStamp.current = d.lastModified
        conflictOpen.current = false
        if (loadTheirs) {
          setContent(d.content)
          setDirty(false)
        }
      })
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [flash])

  useEffect(() => {
    if (!dirty || !autosave) {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
      return
    }
    // Every 30 seconds while changes go on, not after the last keystroke.
    if (autosaveTimer.current) return
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null
      void runAutosave()
    }, AUTOSAVE_MS)
  }, [dirty, content, autosave, runAutosave])

  useEffect(() => {
    installSignature()
  }, [])

  // Drag a file anywhere onto the window: Markdown opens, anything else is
  // handed to the converter.
  useEffect(() => {
    const stop = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onOver = (e: DragEvent): void => {
      stop(e)
      if (e.dataTransfer?.types?.includes('Files')) setAppDragging(true)
    }
    const onLeave = (e: DragEvent): void => {
      stop(e)
      if (e.relatedTarget === null) setAppDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      stop(e)
      setAppDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      // A single Markdown file opens straight away; anything else is converted.
      if (files.length === 1 && isNative(files[0].name)) {
        void (async () => {
          const file = files[0]
          if (!(await guardUnsavedRef.current())) return
          setOpenDoc({ id: null, name: file.name, content: await file.text(), canSaveInPlace: false, copyOfFile: true })
          loadDocument(file.name, await file.text())
          flash(
            'Dropped files arrive as a copy, without permission to change the original. Your changes are kept ' +
              'in My documents; use File > Save as… to save them to a file, or File > Open to edit the file itself.'
          )
        })()
      } else {
        setConvertSeed(files)
      }
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    platform.setTitle(fileName, dirty)
  }, [filePath, dirty])

  useEffect(() => {
    platform.setSettings({ zoom, theme })
  }, [zoom, theme])

  // Ctrl + mouse wheel zoom
  useEffect(() => {
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey) return
      e.preventDefault()
      void actionRef.current(e.deltaY < 0 ? 'view:zoom:in' : 'view:zoom:out')
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        // Innermost thing first: a dialog, then find, then reader mode. Escape
        // should peel one layer, not drop the reader out of the document
        // because a dialog happened to be open over it.
        if (dialog) setDialog(null)
        else if (findOpen) setFindOpen(false)
        else if (readerOn) setReaderOn(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, findOpen, readerOn])

  /* --------------------------------------------------------------- render */

  return (
    <div className={`app ${dark ? 'dark' : 'light'}`}>
      {readerOn && (
        <ReaderControls
          settings={reader}
          onChange={changeReader}
          onExit={() => setReaderOn(false)}
          readOpen={readOpen}
          onReadAloud={() => void actionRef.current('view:readAloud')}
        />
      )}
      <MenuBar onAction={(a) => void actionRef.current(a)} compact={platform.capabilities.touch} pageView={pageView} scansShown={docHasScans && showScans} autosave={autosave} />

      <Toolbar
        mode={mode}
        readerOn={readerOn}
        docOn={docOn}
        zoom={zoom}
        dirty={dirty}
        fileName={fileName}
        sidebar={sidebar}
        aiOpen={aiOpen}
        dictationOpen={dictationOpen}
        readOpen={readOpen}
        mindOpen={mindOpen}
        scans={docHasScans ? (showScans ? 'shown' : 'hidden') : 'none'}
        onAction={(a) => void actionRef.current(a)}
      />

      {findOpen && mode === 'view' && <FindBar onClose={() => setFindOpen(false)} />}

      <main className="workspace">
        {sidebar !== 'none' && (
          <Sidebar
            mode={sidebar}
            headings={headings}
            annotations={annotations}
            activeId={activeId}
            onClose={() => setSidebar('none')}
            onPickHeading={(slug) => {
              setMode('view')
              window.setTimeout(() => previewRef.current?.scrollToSlug(slug), 30)
            }}
            onPickAnnotation={(id) => {
              setActiveId(id)
              setMode('view')
              window.setTimeout(() => previewRef.current?.scrollToAnnotation(id), 30)
            }}
            onEditNote={(id) => {
              const a = annotations.find((x) => x.id === id)
              setDialog({ kind: 'editNote', id, initial: a?.note ?? '' })
            }}
            onRemove={doRemove}
          />
        )}

        <section className="stage">
          {mode === 'view' && docOn && !readerOn ? (
            <DocEditor
              ref={docRef}
              source={content}
              zoom={zoom}
              onChange={(next, label) => commitContent(next, label)}
              onTableEdit={(line) => {
                const range = tableAtLine(content, line)
                const table = range ? parseTable(linesOf(content, range)) : null
                if (range && table) setTableDialog({ kind: 'edit', table, range, via: 'view' })
              }}
              onInsertImage={() => void actionRef.current('insert:image')}
              onUpdateToc={() => void actionRef.current('insert:toc')}
              onTableChange={(line, change, label) => {
                const range = tableAtLine(content, line)
                const table = range ? parseTable(linesOf(content, range)) : null
                if (range && table) commitContent(replaceLines(content, range, serializeTable(change(table))), label)
              }}
            />
          ) : mode === 'view' ? (
            <Preview
              ref={previewRef}
              source={content}
              zoom={zoom}
              activeAnnotation={activeId}
              readerMode={readerOn}
              pageView={pageView}
              hideScans={!showScans}
              onTableEdit={(line) => {
                const range = tableAtLine(content, line)
                const table = range ? parseTable(linesOf(content, range)) : null
                if (range && table) setTableDialog({ kind: 'edit', table, range, via: 'view' })
              }}
              onTableChange={(line, change, label) => {
                const range = tableAtLine(content, line)
                const table = range ? parseTable(linesOf(content, range)) : null
                if (range && table) commitContent(replaceLines(content, range, serializeTable(change(table))), label)
              }}
              onAnnotate={(type, color) => annotate(type, color)}
              onComment={() => void actionRef.current('annot:comment')}
              onLink={() => void actionRef.current('insert:link')}
              onRemoveAnnotation={doRemove}
              onSelectAnnotation={setActiveId}
              onEditAnnotationNote={(id) => {
                const a = annotations.find((x) => x.id === id)
                setDialog({ kind: 'editNote', id, initial: a?.note ?? '' })
              }}
            />
          ) : (
            <div className="edit-split">
              <Editor
                ref={editorRef}
                value={content}
                dark={dark}
                zoom={zoom}
                onChange={(v) => updateContent(v)}
                onCursor={(line, col) => setCursor({ line, col })}
                onFormat={(action) => void actionRef.current(action)}
                blockTintKinds={blockTints}
                onScrollTarget={setEditorTarget}
              />
              <LivePreview
                source={content}
                zoom={zoom}
                onFormat={formatFromPreview}
                onElements={setPreviewEls}
                onTableEdit={(line) => {
                  const text = editorRef.current?.getValue() ?? content
                  const range = tableAtLine(text, line)
                  const table = range ? parseTable(linesOf(text, range)) : null
                  if (range && table) setTableDialog({ kind: 'edit', table, range, via: 'edit' })
                }}
                onTableChange={(line, change) => editTableInEditor(line, change)}
              />
            </div>
          )}
          {mindOpen && (
            <MindMapView
              key={fileName}
              source={content}
              name={fileName}
              dark={dark}
              focus={mindFocus}
              onFocus={setMindFocus}
              openLink={(url) => platform.openExternal(url)}
              registerUndo={(fn) => (mindUndo.current = fn)}
              onClose={() => {
                setMindOpen(false)
                setMindBack(false)
              }}
              onShowInDocument={({ slug, line }) => {
                setMindOpen(false)
                setMindBack(true)
                if (mode === 'edit' && editorRef.current && line >= 0) {
                  editorRef.current.gotoLine(line + 1)
                  return
                }
                if (slug) window.setTimeout(() => previewRef.current?.scrollToSlug(slug), 30)
              }}
              onInsert={(mermaid) => {
                setMindOpen(false)
                const block = '```mermaid\n' + mermaid + '\n```'
                if (mode === 'edit' && editorRef.current) {
                  const ed = editorRef.current
                  const { from, to } = ed.getSelection()
                  ed.applyEdit(insertBlock(ed.getValue(), from, to, block))
                } else {
                  const lines = content.split('\n')
                  const title = lines.findIndex((l) => /^#\s/.test(l))
                  lines.splice(title + 1, 0, '', block)
                  commitContent(lines.join('\n'), 'Insert mind map')
                }
                flash('Mind map inserted as a Mermaid diagram (it draws on GitHub, in Obsidian and other Mermaid-aware apps).')
              }}
              ai={{
                status: async () => {
                  const s = await platform.getSettings()
                  const provider = s?.aiProvider ?? 'ollama'
                  return platform.aiStatus(provider as ProviderId)
                },
                ask: async (system, user) => {
                  const s = await platform.getSettings()
                  const provider = (s?.aiProvider ?? 'ollama') as ProviderId
                  let model: string = s?.aiModel ?? ''
                  if (!model) model = (await platform.aiModels(provider))?.models?.[0] ?? ''
                  return platform.aiChat({ provider, model, system, messages: [{ role: 'user', content: user }], temperature: 0.2, maxTokens: 1200 })
                }
              }}
              saveImage={async (name, data) => {
                await platform.exportFile(name, data, data.type)
              }}
              saveText={async (name, text, mime) => {
                await platform.exportFile(name, text, mime)
                flash(`Saved ${name}`)
              }}
              print={async (html) => {
                await platform.print(html)
              }}
              loadState={async () => {
                try {
                  return localStorage.getItem(`mn-mindmap:${openDoc?.id ?? fileName}`)
                } catch {
                  return null
                }
              }}
              saveState={async (json) => {
                try {
                  localStorage.setItem(`mn-mindmap:${openDoc?.id ?? fileName}`, json)
                  return true
                } catch {
                  return false
                }
              }}
            />
          )}
          {mindBack && !mindOpen && (
            <div className="mm-back" data-mn-ignore>
              <button className="primary" onClick={() => (setMindBack(false), setMindOpen(true))} title="Back to the mind map (Alt+M)">
                ↩ Back to mind map
              </button>
              <button className="link" onClick={() => setMindBack(false)} title="Hide this button">
                ✕
              </button>
            </div>
          )}
        </section>

        {aiOpen && (
          <AiPanel
            docName={fileName}
            docContent={content}
            extraDocs={extraDocs}
            selection={selectionText}
            onClose={() => setAiOpen(false)}
            onAddDocuments={addContextDocuments}
            onRemoveDocument={(id) => setExtraDocs((docs) => docs.filter((d) => d.id !== id))}
            onJumpToChunk={jumpToChunk}
            onApplyRevision={applyAiRevision}
            onApplyAnnotations={applyAiAnnotations}
            onToast={flash}
            pendingQuick={pendingQuick}
            onQuickHandled={() => setPendingQuick(null)}
          />
        )}
      </main>

      {readOpen && (
        <ReadAloudPanel
          options={readOptions}
          toggleSignal={readToggle}
          onOptions={(next) => {
            setReadOptions(next)
            void platform.setSettings({ readAloud: next as unknown as Record<string, unknown> })
          }}
          onClose={() => setReadOpen(false)}
          audiobook={audiobook}
          onLinkAudiobook={async () => {
            // A remembered book first (one click allows it again), else the picker.
            const again = audiobook && !audiobook.url ? await rememberedAudiobook(audioKey, true) : null
            const b = again?.url ? again : await pickAudiobook(audioKey)
            if (b) {
              setAudiobook(b)
              if (!again) flash(`Linked ${b.name}${b.sidecar ? '' : ' (pick its .b2a.json timing file too, for highlighting)'}.`)
            }
          }}
          onUnlinkAudiobook={async () => {
            await forgetAudiobook(audioKey)
            setAudiobook(null)
          }}
        />
      )}

      {dictationOpen && (
        <DictationPanel
          settings={dictation}
          host={DICTATION_HOST}
          toggleSignal={dictationToggle}
          onSettings={(next) => {
            setDictation(next)
            void platform.setSettings({ dictation: next })
          }}
          onActions={applyDictation}
          onClose={() => setDictationOpen(false)}
        />
      )}

      <footer className="statusbar" data-mn-ignore>
        <span>{mode === 'view' ? (docOn && !readerOn ? 'Doc Editor · writes Markdown for you' : 'View mode') : `Edit mode · Ln ${cursor.line}, Col ${cursor.col}`}</span>
        <span>{stats.words} words</span>
        <span>{stats.chars} chars</span>
        <span>{annotations.length} annotations</span>
        <span>~{stats.readMin} min read</span>
        <span className="grow" />
        <span title={autosave ? 'AutoSave is on (File menu)' : 'AutoSave is off (File menu)'}>
          {dirty
            ? 'Unsaved changes'
            : autoSavedAt
              ? `Saved automatically ${openDoc?.canSaveInPlace ? 'to the file' : 'to My documents (this browser)'} at ${autoSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Saved'}
        </span>
        <span>{Math.round(zoom * 100)}%</span>
        <span className="app-version" title="Suprasūtā Markdown Notes version">V{__APP_VERSION__}</span>
      </footer>

      {toast && (
        <div className="toast" data-mn-ignore>
          {toast}
        </div>
      )}

      {appDragging && (
        <div className="drop-overlay" data-mn-ignore>
          <div className="drop-card">
            <div className="dz-icon">⤓</div>
            <strong>Drop to open or convert</strong>
            <span className="muted small">Markdown opens directly · other formats go to the converter</span>
          </div>
        </div>
      )}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}

      {showLibrary && (
        <LibraryDialog
          onClose={() => setShowLibrary(false)}
          onToast={flash}
          onOpen={(id) => {
            setShowLibrary(false)
            void actionRef.current('file:openPath', id)
          }}
        />
      )}

      {aiTool && (
        <AiToolsDialog
          key={aiTool}
          tool={aiTool}
          source={content}
          fileName={fileName}
          ai={aiBridge}
          fetchPage={fetchPageWeb}
          pickProject={pickProjectWeb}
          anySite={false}
          onClose={() => setAiTool(null)}
          onReview={(text, label) => {
            setAiTool(null)
            setPendingDiff({ next: text, label })
          }}
          onOpenNew={async (text, name) => {
            setAiTool(null)
            if (!(await guardUnsaved())) {
              // Not lost: offered as a download instead.
              await platform.exportFile(name, text, 'text/markdown')
              return
            }
            setOpenDoc(null)
            loadDocument(null, refreshToc(text))
            setFileName(name)
            setDirty(true)
            setMode('view')
            flash(`${name} is ready. Save it to keep it.`)
          }}
        />
      )}

      {showDiagram && (
        <DiagramDialog
          editMode={mode === 'edit'}
          onClose={() => setShowDiagram(false)}
          onInsert={(block) => {
            setShowDiagram(false)
            if (docOn) return insertDocMarkdown(block, 'Insert diagram')
            if (mode === 'edit' && editorRef.current) return editorEdit((t, f, to) => insertBlock(t, f, to, block))
            commitContent(content.replace(/\s*$/, '') + '\n\n' + block + '\n', 'Insert diagram')
            flash('Diagram added at the end of the document. Ctrl+Z to undo.')
          }}
        />
      )}

      {showVersions && (
        <VersionsDialog
          docKey={openDoc ? versionKey(openDoc) : null}
          fileName={fileName}
          current={content}
          onClose={() => setShowVersions(false)}
          onRestore={(text, at) => {
            setShowVersions(false)
            setPendingDiff({ next: text, label: `Version from ${at}` })
          }}
        />
      )}

      {pendingDiff && (
        <DiffDialog
          title={`Review ${pendingDiff.label.toLowerCase()}`}
          before={content}
          after={pendingDiff.next}
          reviewDefault={reviewChanges}
          onCancel={() => setPendingDiff(null)}
          onApply={(skipReview) => {
            commitContent(pendingDiff.next, pendingDiff.label)
            if (skipReview) {
              setReviewChanges(false)
              void platform.setSettings({ aiReviewChanges: false })
            }
            setPendingDiff(null)
            flash(`${pendingDiff.label} applied. Ctrl+Z to undo.`)
          }}
        />
      )}

      {compareOpen && (
        <CompareView
          leftName={fileName}
          leftText={content}
          onLeftChange={(text, label) => commitContent(text, label)}
          listSources={compareSources}
          ask={async (system, user) => {
            const s = await platform.getSettings()
            const provider = (s?.aiProvider ?? 'ollama') as ProviderId
            let model = s?.aiModel ?? ''
            if (!model) model = (await platform.aiModels(provider)).models?.[0] ?? ''
            return platform.aiChat({ provider, model, system, messages: [{ role: 'user', content: user }], temperature: 0.2, maxTokens: 1500 })
          }}
          exportReport={(name, data, kind) => platform.exportFile(name, data, kind === 'html' ? 'text/html' : 'text/markdown')}
          confirm={async (title, message) => window.confirm(`${title}\n\n${message}`)}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {mergeOpen && (
        <MergeDialog
          ocrLanguages={ocrLanguages}
          keepPageImages={keepPageImages}
          current={content.trim() ? { name: fileName, markdown: content } : null}
          pickFiles={async () =>
            (await platform.pickFilesToConvert()).map((file) => ({ name: file.name, read: () => platform.readBytes(file) }))
          }
          onClose={() => setMergeOpen(false)}
          onMerged={async (markdown, title, includedOpen) => {
            // The result replaces the open document. When that document went
            // into the merge, its text, unsaved edits included, lives on in
            // the result, so there is nothing to ask: merge, merge again, and
            // save once at the end (or be asked on closing). Only a document
            // left out of the merge would be lost, so only then is saving
            // offered first.
            if (!includedOpen && !(await guardUnsaved())) return
            setMergeOpen(false)
            const name = `${title}.md`
            setOpenDoc({ id: null, name, content: markdown, canSaveInPlace: false })
            loadDocument(name, markdown)
            setDirty(true)
            flash('Files merged into a new document. Save it to keep it (Ctrl+S).')
          }}
        />
      )}

      {convertSeed !== null && (
        <ConvertDialog
          ocrLanguages={ocrLanguages}
          onOcrLanguagesChange={changeOcrLanguages}
          keepPageImages={keepPageImages}
          onKeepPageImagesChange={changeKeepPageImages}
          pdfImages={pdfImages}
          onPdfImagesChange={changePdfImages}
          initialFiles={convertSeed}
          onClose={() => setConvertSeed(null)}
          onToast={flash}
          onOpenResult={async (name: string, markdown: string) => {
            // This replaces the open document, so unsaved work is offered a
            // save first. It used to be replaced without asking.
            if (!(await guardUnsaved())) return
            setConvertSeed(null)
            // The converted document is not yet a file anywhere; open it as an
            // unsaved document so the user chooses where it goes.
            setOpenDoc({
              id: null,
              name: name.replace(/\.[^.]+$/, '') + '.md',
              content: markdown,
              canSaveInPlace: false
            })
            loadDocument(name.replace(/\.[^.]+$/, '') + '.md', markdown)
            setDirty(true)
          }}
        />
      )}

      {dialog?.kind === 'newComment' && (
        <NoteDialog
          title="Add comment"
          initial=""
          onCancel={() => setDialog(null)}
          onSave={(value) => {
            setDialog(null)
            if (value) annotate('comment', undefined, value, dialog.range)
          }}
        />
      )}

      {dialog?.kind === 'editNote' && (
        <NoteDialog
          title="Edit comment"
          initial={dialog.initial}
          onCancel={() => setDialog(null)}
          onSave={(value) => {
            updateContent(updateNote(content, dialog.id, value))
            setDialog(null)
          }}
        />
      )}

      {tableDialog?.kind === 'size' && (
        <TableSizePicker
          onCancel={() => setTableDialog(null)}
          onPick={(rows, cols) =>
            setTableDialog({ kind: 'edit', table: newTable(rows, cols), range: null, via: 'edit', from: tableDialog.from, to: tableDialog.to })
          }
        />
      )}
      {tableDialog?.kind === 'edit' && (
        <TableEditor
          initial={tableDialog.table}
          isNew={!tableDialog.range}
          onCancel={() => setTableDialog(null)}
          onApply={(table) => {
            const d = tableDialog
            setTableDialog(null)
            const markdown = serializeTable(table)
            if (d.via === 'view' && d.range) {
              commitContent(replaceLines(content, d.range, markdown), 'Edit table')
              return
            }
            const ed = editorRef.current
            if (!ed) return
            const text = ed.getValue()
            if (d.range) {
              const at = text.split('\n').slice(0, d.range.start).join('\n').length + (d.range.start ? 1 : 0)
              ed.applyEdit({ text: replaceLines(text, d.range, markdown), selectionStart: at, selectionEnd: at })
            } else {
              ed.applyEdit(insertBlock(text, d.from ?? text.length, d.to ?? text.length, markdown))
            }
          }}
        />
      )}
      {dialog?.kind === 'link' && (
        <NoteDialog
          title="Insert link (the web address; https:// is added if you leave it out)"
          initial=""
          placeholder="astrology.suprasuta.in  or  https://…  or  name@example.com"
          saveLabel="Insert link"
          onCancel={() => setDialog(null)}
          onSave={(typed) => {
            const { from, to, view } = dialog
            setDialog(null)
            // "example.com" becomes https://example.com, an e-mail address a mailto: link.
            const url = normaliseUrl(typed)
            if (!url) return
            if (view) {
              commitContent(content.slice(0, from) + markdownLink(content.slice(from, to), url) + content.slice(to), 'Insert link')
              previewRef.current?.clearSelection()
              flash('Link added. Click it to open it in your browser. Ctrl+Z to undo.')
              return
            }
            editorEdit((t, f, tt) => {
              const inserted = markdownLink(t.slice(f, tt), url)
              return { text: t.slice(0, f) + inserted + t.slice(tt), selectionStart: f, selectionEnd: f + inserted.length }
            })
          }}
        />
      )}
    </div>
  )
}

