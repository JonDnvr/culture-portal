import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build:single` sets SINGLE_FILE=1, which produces one classic script
// bundle that scripts/bundle-single.mjs inlines into a standalone HTML file.
// A standalone file has to avoid ES module scripts, which browsers refuse to
// load over file://, and needs relative paths. The hosted build is the
// opposite on both counts.
const single = process.env.SINGLE_FILE === '1';

export default defineConfig({
  plugins: [react()],
  // Absolute paths for the hosted build: Cloudflare Pages serves index.html
  // for unknown routes, and relative asset paths would resolve against the
  // fake route rather than the site root.
  base: single ? './' : '/',
  server: { port: 5173, open: true },
  build: single
    ? {
        outDir: 'dist-single',
        cssCodeSplit: false,
        modulePreload: false,
        rollupOptions: {
          output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' }
        }
      }
    : {
        outDir: 'dist',
        // Hashed file names let the CDN cache assets forever; splitting the
        // dependencies out means an app change does not re-download React or
        // the Supabase client.
        rollupOptions: {
          output: {
            manualChunks: {
              react: ['react', 'react-dom'],
              supabase: ['@supabase/supabase-js']
            },
            entryFileNames: 'assets/[name].[hash].js',
            chunkFileNames: 'assets/[name].[hash].js',
            assetFileNames: 'assets/[name].[hash].[ext]'
          }
        },
        sourcemap: false,
        reportCompressedSize: false
      }
});
