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
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,wasm}']
      }
    })
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5173 }
})