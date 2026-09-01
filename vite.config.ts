import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const qualityProxyToken = process.env.QUALITY_LAB_PROXY_TOKEN

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __QUALITY_LAB_LOCAL__: JSON.stringify(Boolean(qualityProxyToken)),
  },
  server: {
    strictPort: true,
    proxy: qualityProxyToken
      ? {
          '/api/quality': {
            target: 'http://127.0.0.1:8787',
            changeOrigin: true,
            headers: { 'x-quality-lab-proxy-token': qualityProxyToken },
          },
        }
      : {},
  },
})
