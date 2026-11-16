/**
 * Web app helpers for the documentation tools.
 *
 * Reading a website is for the Windows app: a web page may not read other
 * sites, and the app's security policy (connect-src) keeps it that way. There
 * is deliberately no relay server: one that fetches any address for anyone
 * would be open to abuse.
 *
 * Reading a folder: Chrome and Edge let the reader pick a folder and read it;
 * other browsers get an ordinary "choose folder" input. Nothing is uploaded.
 */
import { PROJECT_LIMITS, PROJECT_SKIP_DIRS, PROJECT_TEXT_FILES, type FetchPage, type ProjectFile } from '../lib/aiTools'

/** Browsers block reading other websites (and the app's security policy does too): the Windows app does this. */
export const fetchPageWeb: FetchPage = async () => ({ ok: false, error: 'Reading websites needs the Windows app.' })

type DirHandle = { name: string; kind: 'directory'; values: () => AsyncIterable<DirHandle | FileHandle> }
type FileHandle = { name: string; kind: 'file'; getFile: () => Promise<File> }

export async function pickProjectWeb(): Promise<{ name: string; files: ProjectFile[]; skipped: number } | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<DirHandle> }).showDirectoryPicker
  const files: ProjectFile[] = []
  let skipped = 0
  let total = 0
  const take = async (path: string, file: File): Promise<void> => {
    if (PROJECT_SKIP_DIRS.test(path) || !PROJECT_TEXT_FILES.test(path)) return
    if (files.length >= PROJECT_LIMITS.files || file.size > PROJECT_LIMITS.fileBytes || total + file.size > PROJECT_LIMITS.totalBytes) {
      skipped++
      return
    }
    const text = await file.text()
    if (text.includes('\u0000')) return
    total += file.size
    files.push({ path, text })
  }
  if (picker) {
    let root: DirHandle
    try {
      root = await picker({ mode: 'read' })
    } catch {
      return null
    }
    const walk = async (dir: DirHandle, prefix: string): Promise<void> => {
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.kind === 'directory') {
          if (!PROJECT_SKIP_DIRS.test(`${path}/`)) await walk(entry, path)
        } else await take(path, await entry.getFile())
      }
    }
    await walk(root, '')
    return { name: root.name, files, skipped }
  }
  const list = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    ;(input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
  if (!list.length) return null
  const name = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] ?? 'Project'
  for (const f of list) {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name).split('/').slice(1).join('/') || f.name
    await take(rel, f)
  }
  return { name, files, skipped }
}
