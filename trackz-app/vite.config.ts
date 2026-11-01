import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Phase 15b: proxy /api to a locally-running `vercel dev` (default port
    // 3000), so the browser sees the API and the app on ONE origin, exactly
    // as it does in production.
    //
    // This is not a convenience — it is required for sync to work in dev.
    // The refresh token lives in a SameSite=Lax httpOnly cookie, and the
    // browser will not send such a cookie on a cross-site request. Pointing
    // the frontend straight at localhost:3000 would therefore break session
    // restore while appearing to work for everything else.
    //
    // Run both: `vercel dev --listen 3000` and `npm run dev`.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // Keep the original Host header (this is Vite's default, but it is
        // load-bearing here, so it is stated explicitly). The endpoints
        // compare Origin against Host to reject cross-origin posts; if the
        // proxy rewrote Host to localhost:3000 while the browser's Origin
        // stayed localhost:5173, every dev request would 403.
        changeOrigin: false,
      },
    },
  },
})
