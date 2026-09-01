import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The single-file preview build.
 *
 * Its only job is to produce one self-contained HTML document that opens from a link with no
 * server, no install and no Supabase project — so somebody deciding whether this beats their
 * clipboard can hold it before anyone sets up infrastructure.
 *
 * Two differences from the real build, both forced here rather than left to the environment:
 *
 *  - **No manual chunks.** The production build splits vendors so a redeploy between clients
 *    re-downloads only app code. Here that is exactly wrong: the chunks are ES modules that
 *    import each other by URL, and those URLs cannot survive being folded into one document.
 *  - **Hash routing and the local repository**, set through `define` so they hold no matter what
 *    the ambient environment says. A preview that quietly tried to reach a server would be a
 *    worse lie than not shipping one.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    'import.meta.env.VITE_HASH_ROUTER': JSON.stringify('1'),
    'import.meta.env.VITE_OFFLINE_FIXTURE': JSON.stringify('1'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
  },
  build: {
    outDir: 'dist-preview',
    // One chunk, one stylesheet, nothing to resolve at runtime.
    rollupOptions: { output: { inlineDynamicImports: true } },
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
})
