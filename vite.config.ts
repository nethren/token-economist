import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Never inline fonts as data: URIs. The production CSP allows fonts only
    // from 'self' (vercel.json), so an inlined subset would be blocked.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
  server: {
    strictPort: true,
  },
})
