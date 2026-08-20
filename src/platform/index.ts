/**
 * Chooses the right platform implementation and exposes it as a singleton.
 *
 * Components import `platform` from here and never care which one they got.
 * When the Capacitor build lands it will slot in below without touching a
 * single component.
 */
import { WebPlatform } from './web'
import { CapacitorPlatform } from './capacitor'
import type { Platform } from './types'

export * from './types'

function detect(): Platform {
  // Capacitor injects this global into the native WebView.
  const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (native?.isNativePlatform?.()) return new CapacitorPlatform()
  return new WebPlatform()
}

export const platform: Platform = detect()
