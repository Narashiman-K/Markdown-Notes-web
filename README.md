<div align="center">

# Suprasūtā Markdown Notes — Web & Mobile

**Read, annotate and convert documents in your browser. Nothing leaves your device.**

### → [markdown-notes-psi.vercel.app](https://markdown-notes-psi.vercel.app)

The browser and Android version of
[Suprasūtā Markdown Notes for Windows](https://github.com/Narashiman-K/Markdown-Notes-windows).

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

The web build is wrapped with Capacitor and bundled inside the package, so the
app works with no connection at all.

**Google Play is not a current target.** A personal developer account cannot
publish to production without 12 testers staying opted in for 14 continuous
days, which is not realistic for a one-person project. Android users are served
by the PWA instead: open the site in Chrome and choose *Install app*, and it
lands on the home screen and works offline, with no store involved.

The Android build is kept and kept working, but it no longer runs on every push.
Trigger it from the Actions tab with **Run workflow** to get a debug APK, or
push a `v*` tag to get a **signed AAB**. Should Play ever become worthwhile,
**[docs/PLAY-STORE.md](docs/PLAY-STORE.md)** has the keystore steps, the secrets,
the listing copy and the Data Safety answers ready to go.

To build locally instead, with Android Studio installed:

```bash
npx vite build
npx cap add android
npx cap sync android
npx cap open android
```

`android/` is generated, not committed — it derives entirely from
`capacitor.config.ts` and the built web app.

### Why Android lives in this repo

Capacitor has no source of its own: it wraps the `dist/` produced by the web
build. Only two files here exist solely for Android — `capacitor.config.ts` and
`src/platform/capacitor.ts`, about 100 lines between them — and the second is a
subclass of `WebPlatform` that belongs beside it. A separate repository would
hold those hundred lines plus a submodule or published package to reach the web
build, adding a sync step for no isolation gained.

## Architecture

Everything platform-specific sits behind one interface, so the same components
run in a browser, in an Android WebView, and previously in Electron:

```
src/
  platform/
    types.ts      the contract
    web.ts        browsers — File System Access API, IndexedDB, fetch
    capacitor.ts  Android — native filesystem and share sheet
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
