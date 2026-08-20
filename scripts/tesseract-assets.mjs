/**
 * Stages the Tesseract engine and English language model into `public/tesseract`
 * so offline OCR is genuinely offline.
 *
 * Without this, tesseract.js fetches its worker, its WASM core and a ~3 MB
 * language model from jsdelivr the first time a user picks "offline" OCR. The
 * image itself is never uploaded, but the feature simply fails with no signal —
 * which is the one situation offline OCR exists for. On Android the files end up
 * inside the APK, so the promise holds on a plane.
 *
 * The staged files are gitignored: they are copied out of node_modules on every
 * build rather than committed, so they cannot drift from the installed version.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'tesseract')

/** Resolves a package's directory without importing it. */
function packageDir(name) {
  return dirname(require.resolve(`${name}/package.json`))
}

/**
 * Only the SIMD LSTM core is staged, at roughly 3.9 MB.
 *
 * The plain (non-LSTM) cores are twice the size and tesseract.js v5+ does not
 * use them. The non-SIMD core would add another 3.9 MB to guard against
 * browsers without WebAssembly SIMD, which Chromium has had since 2021 and
 * every Android WebView on a supported device therefore has too. On the rare
 * device that lacks it, ocr.ts falls back to the library's CDN default rather
 * than failing, so the cost of leaving it out is a slower first run for almost
 * nobody instead of 3.9 MB for everybody.
 */
const CORES = ['tesseract-core-simd-lstm.wasm.js']

async function main() {
  await mkdir(outDir, { recursive: true })

  const copied = []

  const workerSrc = join(packageDir('tesseract.js'), 'dist', 'worker.min.js')
  await copyFile(workerSrc, join(outDir, 'worker.min.js'))
  copied.push('worker.min.js')

  const coreDir = packageDir('tesseract.js-core')
  for (const file of CORES) {
    const src = join(coreDir, file)
    if (!existsSync(src)) {
      throw new Error(
        `Expected ${file} in tesseract.js-core. The package layout changed; ` +
          `update CORES in scripts/tesseract-assets.mjs. Present: ` +
          (await readdir(coreDir)).filter((f) => f.endsWith('.js')).join(', ')
      )
    }
    await copyFile(src, join(outDir, file))
    copied.push(file)
  }

  /**
   * `4.0.0_best_int` is the integerised "best" model: markedly more accurate
   * than the fast model on the scanned and photographed pages this app sees,
   * and 3 MB rather than 11 MB for the full-precision one.
   */
  const langSrc = join(packageDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz')
  await copyFile(langSrc, join(outDir, 'eng.traineddata.gz'))
  copied.push('eng.traineddata.gz')

  let total = 0
  for (const name of copied) total += (await stat(join(outDir, name))).size
  console.log(
    `tesseract: staged ${copied.length} files, ${(total / 1024 / 1024).toFixed(1)} MB → public/tesseract`
  )
}

main().catch((err) => {
  console.error(`\ntesseract asset staging failed: ${err.message}\n`)
  process.exit(1)
})
