/**
 * Exposes the browser platform implementation as a singleton.
 *
 * Components import `platform` from here and never touch a browser API
 * directly. That indirection is what let the same components run under
 * Electron, and it is what lets the Android build in the separate
 * Markdown-Notes-Android repository substitute its own implementation without
 * changing a single component.
 */
import { WebPlatform } from './web'
import type { Platform } from './types'

export * from './types'

export const platform: Platform = new WebPlatform()
