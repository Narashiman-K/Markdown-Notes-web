import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Suprasuta Markdown Notes',
        short_name: 'Suprasuta',
        description: 'Markdown viewer, editor, annotator and document converter',
        theme_color: '#0f6cbd',
        background_color: '#1f1f1f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The document libraries are large; raise the precache ceiling so the
        // app genuinely works offline rather than half-caching.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,wasm}'],

        // The OCR engine and language model are ~6.7 MB and most people never
        // touch offline OCR. Precaching them would charge every visitor that
        // download on first load, so they are excluded here and cached at
        // runtime instead, the first time OCR actually runs.
        globIgnores: ['**/tesseract/**'],
        runtimeCaching: [
          {
            urlPattern: /\/tesseract\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-engine',
              // Immutable build output: once fetched there is no reason to
              // revalidate, and a year is as close to "never" as this allows.
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5173 }
})