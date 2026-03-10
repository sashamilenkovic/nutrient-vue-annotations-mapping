import { fileURLToPath, URL } from 'node:url'
import { cpSync } from 'node:fs'
import path from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Copy Nutrient SDK assets to public/ so they're served statically.
// NOTE: Copying from node_modules is deprecated for released versions (use the
// self-host ZIP instead). We use it here because nightly builds don't publish
// a separate assets archive. The deprecation warning in the console is expected.
const sdkAssetsSrc = path.resolve(
  __dirname,
  'node_modules/@nutrient-sdk/viewer/dist/nutrient-viewer-lib',
)
const sdkAssetsDest = path.resolve(__dirname, 'public/nutrient-viewer-lib')
cpSync(sdkAssetsSrc, sdkAssetsDest, { recursive: true, force: true })

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
