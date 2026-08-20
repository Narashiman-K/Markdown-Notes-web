import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android packaging.
 *
 * `webDir: 'dist'` bundles the built app inside the APK, so it works with no
 * connection at all — converting a PDF offline still works. The trade-off is
 * that content changes need a Play Store review; loading from a URL instead
 * would update instantly but require a connection on first launch.
 */
const config: CapacitorConfig = {
  appId: 'com.suprasuta.markdownnotes',
  appName: 'Suprasuta Markdown Notes',
  webDir: 'dist',

  android: {
    // Cleartext is off: the app only ever talks to HTTPS endpoints. The one
    // exception is a local Ollama server, which is unreachable from a phone
    // anyway, so nothing is lost by keeping this locked down.
    allowMixedContent: false,
    captureInput: true
  },

  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1f1f1f'
    }
  }
}

export default config
