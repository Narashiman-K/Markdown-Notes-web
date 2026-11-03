# Architecture — Suprasūtā Markdown Notes (Web)

The browser build: the same editor, converters and annotation system as the
Windows app, running entirely on the client as an installable PWA.

This document is for someone who has cloned the repository and wants to find
their way around without breaking an invariant they could not have guessed at.

---

## 1. At a glance

| | |
|---|---|
| Version | 1.2.0 (shown bottom right; live at markdown-notes-psi.vercel.app) |
| Build | Vite 7 + React 18 + TypeScript |
| Editor | CodeMirror 6 |
| Renderer | markdown-it → DOMPurify |
| Offline | vite-plugin-pwa, `registerType: 'autoUpdate'` |
| Server | **none** — every conversion runs in the browser |
| WASM | one: the Tesseract OCR engine (English, Kannada, Hindi built in) |
| Hosting | Vercel, deployed on every push to `main`; CSP and Permissions-Policy in `vercel.json` |

Nothing is uploaded. Documents are converted, rendered, annotated and exported
without leaving the tab. The only outbound requests are AI provider calls the
user has explicitly configured with their own key.

---

## 2. Layout

```
src/
  App.tsx            document state and the action switch
  platform/
    types.ts         the Platform interface — read this first
    web.ts           WebPlatform: File System Access, downloads, printing
    secrets.ts       API keys, AES-GCM in IndexedDB
    index.ts         exports the singleton
  components/        Editor, Preview, LivePreview, MenuBar, AiPanel, …
  lib/               the algorithms — see §4
  lib/convert/       document converters — see §5
  styles/            app.css, markdown.css
  shared/            brand.ts, formats.ts, types.ts
scripts/
  tesseract-assets.mjs   stages the OCR engine into public/ before every build
```

---

## 3. The Platform interface

`src/platform/types.ts` is the contract between the application and whatever it
is running on. Components and everything in `lib/` know nothing about browsers:

> Everything platform-specific lives behind this interface: file access,
> persistence, printing, credentials and network calls to AI providers.

It is deliberately wider than the browser needs. It describes what the Electron
desktop build does too, which is why a component can be copied between the two
repositories rather than rewritten.

`WebPlatform` (`platform/web.ts`, ~560 lines) implements it using:

- **File System Access API** where available, for real save-in-place. Where it
  is not, the app falls back to download-and-reopen, and `canSaveInPlace` on
  `OpenDocument` tells the UI which world it is in.
- **IndexedDB** for the in-app library of saved documents.
- Blob URLs and `window.print()` for export and printing.

If you add a capability, add it to `types.ts` first and then implement it. A
component reaching for a browser API directly is a bug, not a shortcut — it is
the thing that stops the file being copyable to the desktop repository.

---

## 4. The algorithms

These live in `src/lib/` and are shared byte-for-byte with the Windows app.

### An invariant that reaches across modules

`lib/markdown.ts` configures markdown-it with `typographer`, `linkify` and
smartquotes **off**. That is not a style preference. It keeps the rendered text
a character-for-character subsequence of the source, which is the property
`lib/align.ts` depends on. Turning smart quotes on would replace `"` with `"`,
the subsequence property would break, and annotations would start landing in
the wrong place with no obvious connection to the change that caused it.

### `align.ts` — rendered text back to source offsets

Annotations are applied by selecting text in the *preview*, so a DOM range has
to resolve to a range in the Markdown *source*. `buildSourceMap` walks both
strings forward with two pointers.

The rule that makes it work is subtractive: whitespace is recorded but **never
searched for, and never advances the cursor**. The renderer puts a newline
between two table cells whose source reads `| Site | Purpose |`; searching
forward for that newline jumps the cursor past `Purpose`, which can then never
be found, because the walk only moves forward. One table was enough to corrupt
every offset after it.

The second rule: **hidden stretches are stepped over** (`hiddenRanges`): a
picture's whole `![alt](address)`, a link's `(address)`, HTML tags and
comments. Pictures here are embedded as data URLs, tens of thousands of
letters long; the walk used to find the next visible letters inside one, so a
highlight beside a picture was written into its data and the picture showed
as text (fixed in 1.2.0; `repairPictures()` mends affected files on opening).

### `syncScroll.ts` — editor and preview together

Both sides implement the same `ScrollSyncTarget` interface and `linkScrollers`
joins any two. Neither is the master — when one side is treated as
authoritative, the pane you are *not* touching starts fighting you. The preview
side reads `data-line` attributes stamped by a markdown-it core rule that only
fires when `env.sourceLines` is set, so line numbers never reach exported HTML.

### `blockTints.ts` — background tints per block

Converted documents produce long stretches with no visual structure; a
spreadsheet becomes a 200-line table that looks like the prose above it. Syntax
highlighting colours the *markers*, which is no help when the markers are off
screen — exactly when you need to know whether you are still inside the block.
Ranges come from the Lezer tree the Markdown mode already maintains, which is
incremental, so typing in a large document reuses the parse.

### `smartPaste.ts` — paste from Word, Excel, a browser

Reads the clipboard's HTML flavour and converts it through the same
`htmlToMarkdown` the document converters use, so pasting a table and converting
a document containing one cannot produce two dialects in the same file.

`fragment()` trims to `<!--StartFragment-->` markers but refuses a slice that
would orphan `<tr>` elements, because Excel puts its markers *inside* the table.
`promoteHeaderRows()` drops empty rows and picks the widest row as the header,
because a merged title row otherwise makes the header one column wide.

### `annotations.ts` — annotations stored in the document

Highlights, underlines and comments are HTML tags written **into the Markdown**,
not held in a sidecar. The document stays portable. `codeRegions()` and
`segmentRange()` split a selection spanning a code fence rather than injecting
tags into code, and never let a tag start or end inside a picture or a link
address.

### `annotationTransfer.ts` — annotations out of a file and back

Export records each annotation's words, surrounding words, section and
position; import finds them again on any copy, even an edited one (exact,
then spacing-insensitive, then bigram similarity), adds while skipping
duplicates or makes the document match the file, and lists what it could not
place. Identical to the Windows copy.

### `compare.ts` and `tabLink.ts` — Compare documents

Myers' difference over lines, then over the words of each changed block;
nothing ignored except CRLF line endings; capped so a pathological pair
cannot exhaust memory. `CompareView.tsx` (shared with Windows) shows it side
by side or inline, takes changes across, edits either side and exports HTML or
Markdown. In the browser the other side can also be a document open in
another tab: `tabLink.ts` uses a `BroadcastChannel` (never leaves the
browser) to list tabs, fetch a tab's text and send edited text back as an
undoable change there.

### `retrieval.ts` — grounding for the AI panel

BM25 keyword ranking over chunks split on heading boundaries. No embeddings, no
model, no network — which is what keeps the offline promise intact.

### `history.ts` — undo above the editor

CodeMirror's history covers typing in the source editor only. Annotations
applied in view mode and AI edits happen outside it, so a 120-entry
document-level stack sits above the whole document.

---

## 5. Converters and offline OCR

`src/lib/convert/` turns PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, CSV,
HTML, images and audio into Markdown. Pure: bytes in, Markdown out. This
directory is **one of four copies** across the project family — see §8.

`scripts/tesseract-assets.mjs` runs before `dev` and `build`, and matters more
than its size suggests. Without it, tesseract.js fetches its worker, its WASM
core and a ~3 MB language model from a CDN the first time someone picks offline
OCR — so the feature fails with no signal in precisely the situation it exists
for. The staged files are gitignored and re-copied from `node_modules` every
build, so they cannot drift from the installed version.

Pictures are kept from PDFs with text (placed where they sit on the page),
Word, PowerPoint and EPUB, as embedded JPEG data URLs. EPUB chapters are
parsed as XHTML and internal links become `#epub-N` anchors; `Preview.tsx`
follows the written href, so a relative link never loads a blank page.
Spreadsheets are parsed in a worker stopped at a time limit (SheetJS 0.20.3,
vendored).

### Files and AutoSave in a browser

Chrome and Edge open real files with the File System Access API, and AutoSave
writes back into them; the status bar names where it saved. `readOnDisk`
re-reads the file to notice changes made elsewhere (the Windows app, another
editor) and asks which version to keep. Other browsers, or a file picked
without write permission, save into the in-app library (My documents) and can
download a copy.

---

## 6. Credentials — an honest limitation

`platform/secrets.ts` states it plainly, and so does the AI settings panel:

The Windows build encrypts keys with DPAPI, where the operating system holds the
secret. A browser has no equivalent reachable from JavaScript. What this build
does instead is generate an AES-GCM key that the browser marks
**non-extractable** — script can ask the browser to encrypt and decrypt with it
but can never read the key material, and cannot copy it out of IndexedDB.

- **That defeats:** someone reading your stored data, copying the database to
  another machine, an extension scraping localStorage for anything key-shaped.
- **That does not defeat:** script running on this exact origin. If the site
  were compromised, or you installed an extension with full access to it, the
  keys are reachable.

It is a real improvement over plain text and it is not DPAPI. The UI says so
rather than implying otherwise. Keep it that way.

---

## 7. Build and test

```
npm run dev          vite (stages Tesseract assets first)
npm run build        tsc --noEmit && vite build
npm run typecheck    tsc --noEmit
npm test             vitest — 16 suites, ~215 tests
npm run audit:gate   dependency audit; fails on unaccepted high/critical
```

The audit gate runs in CI on every push. Its allowlist is empty; remaining
moderate/low advisories sit in build-time tooling (vite-plugin-pwa's workbox
chain), not in the page users load.

If the page comes up blank after pulling changes, clear `node_modules/.vite` —
a stale dependency-optimisation cache is the usual cause and it does not
announce itself.

---

## 8. This repository's place in the family

| Repository | What it is |
|---|---|
| **Markdown-Notes-web** (this one) | Browser app, PWA |
| Markdown-Notes-windows | Electron desktop app, Microsoft Store |
| Markdown-Notes-MCP | MCP server for Claude Desktop and other hosts |
| Markdown-Notes-VSCode | VS Code / Antigravity extension |

### Shared code is copied, not depended on

The converters exist in four copies by deliberate choice. A shared npm package
would remove drift by construction — and would also tie four independent release
cadences together, so a converter fix could not reach this app without a publish
cycle, and the PWA cache, the MSIX and the VSIX would all have to move at once.

The judgement was that independent release cadences are worth more than enforced
sameness, **provided drift is visible**. `Markdown-Notes-MCP` carries
`scripts/sync-converters.mjs` for that, and its copy is canonical — it is the
only one with the runtime hook that lets identical files run in a browser and
under Node, so improvements start there and flow outward.

### Shared UI with the Windows app

26 of the 42 comparable files are byte-identical, including `Editor.tsx`,
`LivePreview.tsx`, `ReaderControls.tsx`, `Toolbar.tsx`, and nearly all of
`lib/`. Those files carry a line in their header:

> *Kept identical to the copy in the Windows app. Change one, copy it across.*

Take it literally. If you change a shared file here, copy it to
`Markdown-Notes-windows` in the same commit.

The files that legitimately differ are the ones that touch the platform:
`App.tsx`, `MenuBar.tsx`, `ConvertDialog.tsx`, `FindBar.tsx`, `app.css`, plus
this repository's own `LibraryDialog.tsx` and `lib/dialogs.tsx`, which exist
because a browser has no native file dialogs to borrow.

---

## 9. Conventions worth knowing

- **z-index bands.** Declared at the top of `app.css`: document furniture
  (0–59), docked panes (60–99), application chrome (100–199), window-level
  overlays (200+). A menu is the user acting on the app, so nothing inside the
  document may paint over it. Add to a band rather than picking a number.
- **`data-mn-ignore`** marks elements the annotation walker must skip.
- **Provenance.** `lib/signature.ts` stamps authorship into the live DOM and
  into exported HTML and PDF.
- **Capacitor packages remain in `package.json`.** The Android build was
  dropped in September 2026; the dependencies were left rather than ripped out,
  so the port stays available. They are not part of the web build.
- **Never paste an access token into a chat, an issue, or a commit.**

---

## 10. Where this is going

Shipped in 1.1.0: regex find and replace, symmetric sync scrolling, format
editing in the live preview, per-block background tints, smart paste.

Shipped in 1.2.0: Compare documents (with other tabs), Reader mode, Merge
files, AutoSave into real files, annotation export and import, pictures from
PDF/Word/PowerPoint/EPUB, full EPUB with working links, offline OCR in English,
Kannada and Hindi with upright-page detection, page view, the version in the
corner, a Content-Security-Policy and the audit gate.

Planned next: anonymous usage analytics (on by default, no content or personal
data), read aloud and dictation (free and offline), more OCR languages on
demand, an annotation study sheet, a table editor.
