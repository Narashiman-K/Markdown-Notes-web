/**
 * Android overrides.
 *
 * Almost everything from WebPlatform works unchanged inside the native WebView:
 * IndexedDB, Web Crypto, the converters and every fetch. Only file output is
 * genuinely different — a WebView download does nothing useful on Android — so
 * that is all this class replaces.
 */
import { WebPlatform } from './web'

interface FilesystemPlugin {
  writeFile(options: {
    path: string
    data: string
    directory: string
    encoding?: string
    recursive?: boolean
  }): Promise<{ uri: string }>
  getUri(options: { path: string; directory: string }): Promise<{ uri: string }>
}

interface SharePlugin {
  share(options: { title?: string; text?: string; url?: string; dialogTitle?: string }): Promise<void>
}

export class CapacitorPlatform extends WebPlatform {
  constructor() {
    super()
    const caps = this.capabilities as { native: boolean; fileSystemAccess: boolean; localAi: boolean }
    caps.native = true
    // The File System Access API does not exist in the Android WebView, and
    // Ollama cannot be reached from a phone.
    caps.fileSystemAccess = false
    caps.localAi = false
  }

  /**
   * Writes to the device's Documents folder and offers the system share sheet,
   * which is what an Android user expects instead of a browser download.
   */
  override async exportFile(name: string, data: string | Blob, mimeType: string): Promise<void> {
    try {
      const { Filesystem, Directory, Encoding } = (await import('@capacitor/filesystem')) as unknown as {
        Filesystem: FilesystemPlugin
        Directory: Record<string, string>
        Encoding: Record<string, string>
      }

      const text = typeof data === 'string' ? data : await data.text()
      await Filesystem.writeFile({
        path: name,
        data: text,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true
      })

      const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Documents })

      const { Share } = (await import('@capacitor/share')) as unknown as { Share: SharePlugin }
      await Share.share({ title: name, url: uri, dialogTitle: `Share ${name}` })
    } catch {
      // If the plugins are unavailable, a browser download is still better
      // than silently failing.
      await super.exportFile(name, data, mimeType)
    }
  }

  override async print(html: string): Promise<void> {
    // Android's WebView has no print dialog worth using; sharing the HTML lets
    // the user send it to Google Drive, Files, or a printing app.
    await this.exportFile('document.html', html, 'text/html')
  }
}
