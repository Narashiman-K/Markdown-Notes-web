<div align="center">

# Suprasūtā Markdown Notes — Web

**Read, annotate and convert documents in your browser. Nothing leaves your device.**

### → [markdown-notes-psi.vercel.app](https://markdown-notes-psi.vercel.app)

The browser version of Suprasūtā Markdown Notes, also available
[for Windows on the Microsoft Store](https://apps.microsoft.com/detail/9N1S7QP2WNLX)
([source](https://github.com/Narashiman-K/Markdown-Notes-windows)).

Created by **[Narashiman Krishnamurthy](https://www.linkedin.com/in/narashimank/)**

</div>

---

> **Licence:** free for personal, non-commercial use. See [LICENSE.md](LICENSE.md).

## What it does

- **Annotate Markdown** — highlights, underlines, strikethrough and comments,
  written *into* the `.md` file as standard HTML so the document stays portable
- **Edit** — CodeMirror source editor with a formatting bar on selection
- **Convert to Markdown** — PDF, Word, Excel, PowerPoint, ODT, ODS, EPUB, CSV
  and text, all **converted inside your browser** with no upload
- **Ask your documents** — AI answers drawn only from the documents you load,
  with citations, refusing to guess when something is not covered

## Privacy

Documents, annotations and settings never leave your device. There is no
account, no analytics and no telemetry.

Three optional features can reach the internet, and only after you enable them
with your own API key:

| Feature | Where data goes |
| --- | --- |
| AI assistant | Anthropic, OpenAI or Google — your choice, your key |
| Image OCR | Google, or entirely offline |
| Audio transcription | AssemblyAI (the only feature that cannot run offline) |

Offline OCR really is offline: `scripts/tesseract-assets.mjs` stages the
recognition engine and English model into the build, so nothing is fetched from
a CDN at first use. Full policy: **[privacy.html](https://markdown-notes-psi.vercel.app/privacy.html)**.

**API keys** are encrypted with AES-GCM using a key the browser will not let
JavaScript read, stored in IndexedDB. That stops keys being copied out of
storage or scraped by most extensions. It is **not** equivalent to the Windows
version's DPAPI encryption: script running on this origin could still ask the
browser to decrypt. The app says so rather than implying otherwise.

## How it differs from the Windows version

| | Windows | Web |
| --- | --- | --- |
| Open and save real files | Always | Chrome and Edge desktop; others use the in-app library |
| Save as PDF | Direct | Through the print dialog's "Save as PDF" |
| Local AI (Ollama) | Yes | Desktop browsers only, and needs `OLLAMA_ORIGINS` set |
| OpenAI and audio | Direct | Through a serverless relay, because both refuse browser requests |
| Images in documents | Linked from disk | Embedded, since a browser cannot read a local path |

## Serverless relays

`api/openai.ts` and `api/assemblyai.ts` exist for one reason: both providers
refuse cross-origin browser requests, so a web page cannot call them at all.

Each is deliberately tiny so it can be read and verified. They **do not store
the API key, do not log it, and keep no state** — the key arrives in a header,
is forwarded on the same request, and is discarded. Anthropic and Google are
called directly from the browser and never touch them.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 101 unit tests
npm run build      # production build to dist/
```

### Using local AI in a browser

Ollama refuses requests from web origins unless told otherwise:

```powershell
setx OLLAMA_ORIGINS "http://localhost:5173"   # add your deployed origin too
```

Restart Ollama afterwards. This has no effect on phones — Ollama runs on a
computer, so mobile users need a cloud key.

## Android

The Android build lives in its own repository:
**[Markdown-Notes-Android](https://github.com/Narashiman-K/Markdown-Notes-Android)**.

It is a separate codebase rather than a build target of this one, so nothing
here carries Capacitor, an Android toolchain or Play Store paperwork. Android
users can also simply install this site: open it in Chrome and choose
*Install app*, and it runs from the home screen, offline, with no store
involved.

## Architecture

Everything platform-specific sits behind one interface. Only `web.ts` exists
here, but the contract is deliberately the same one the Windows and Android
builds implement, so a component moves between them as a copy rather than a
rewrite:

```
src/
  platform/
    types.ts      the contract
    web.ts        browsers — File System Access API, IndexedDB, fetch
    secrets.ts    AES-GCM key storage
  lib/            ported unchanged from the Windows app
    annotations.ts, align.ts, retrieval.ts, aiPrompts.ts, diff.ts, history.ts
    convert/      all nine document converters
  components/     React UI
  shared/         types, brand, format registry
api/              serverless relays (Vercel)
```

Roughly 70% of the codebase is shared with the Windows version verbatim,
because `lib/` was written without any Electron dependency from the start.
