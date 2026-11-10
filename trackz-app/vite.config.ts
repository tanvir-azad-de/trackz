import preact from '@preact/preset-vite'
import { defineConfig, type Plugin } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { stampServiceWorker } from './src/pwa/stampServiceWorker.ts'
import { buildVersionLabel } from './src/app/buildVersion.ts'

/**
 * Stamp a build id into dist/sw.js so the browser actually notices deploys.
 *
 * Thin half by design: every decision lives in the pure, tested
 * src/pwa/stampServiceWorker.ts, and this only gathers bytes and writes
 * one file. See that module for why the bug existed and why the id hashes
 * content rather than reading Vite's filename hashes.
 *
 * writeBundle, not closeBundle: writeBundle receives the emitted bundle,
 * and Vite has already copied publicDir into dist by this point, so
 * dist/sw.js exists and is not overwritten afterwards.
 *
 * apply: 'build' because publicDir is served from memory in dev — there is
 * no dist/sw.js to rewrite, and registerServiceWorker.ts refuses to
 * register at all outside PROD.
 */
function stampServiceWorkerPlugin(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir
      if (!outDir) throw new Error('stamp-service-worker: no output dir')

      // Rollup splits these two: chunks carry `code`, static assets carry
      // `source`. Both are needed — index.html arrives as an asset, and it
      // is the file whose changes the filename-hash approach missed.
      const files = Object.values(bundle).map((entry) => ({
        fileName: entry.fileName,
        content:
          entry.type === 'chunk'
            ? entry.code
            : typeof entry.source === 'string'
              ? entry.source
              : Buffer.from(entry.source).toString('base64'),
      }))

      const swPath = resolve(outDir, 'sw.js')
      const source = readFileSync(swPath, 'utf8')

      writeFileSync(swPath, stampServiceWorker(source, files))
    },
  }
}

/**
 * The commit being built. Vercel's env var first: it is always set there,
 * whereas a git checkout on the build machine is an implementation detail.
 * Falls back to local git, then to undefined ("dev").
 */
function currentCommitSha(): string | undefined {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return undefined
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), stampServiceWorkerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersionLabel(currentCommitSha(), new Date().toISOString())),
  },
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
