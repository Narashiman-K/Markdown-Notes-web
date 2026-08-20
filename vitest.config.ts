import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Vite serves mammoth browser build; make tests use the same one.
      mammoth: resolve(__dirname, 'node_modules/mammoth/mammoth.browser.js')
    }
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})