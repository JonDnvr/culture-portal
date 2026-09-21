import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * This deployment's Supabase project. Both values are public by design: they
 * end up inside the web page whatever you do, and row level security is what
 * protects the data. Keeping them here means the host needs no environment
 * variables, which removes the easiest way to deploy a broken site.
 *
 * Never put the secret key (sb_secret_...) or the service role key here.
 *
 * A variable set on the host still wins, so a second deployment pointing at a
 * different project only has to set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */
const PRODUCTION = {
  VITE_SUPABASE_URL: 'https://scypggscxntpaakdjelr.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_L4cSuNhddUyR2JrsYpMKpQ_fIgQrqEu'
};

// `npm run build:single` sets SINGLE_FILE=1, which produces one classic script
// bundle that scripts/bundle-single.mjs inlines into a standalone HTML file.
// A standalone file has to avoid ES module scripts, which browsers refuse to
// load over file://, and needs relative paths. The hosted build is the
// opposite on both counts.
const single = process.env.SINGLE_FILE === '1';

export default defineConfig(({ command }) => {
  // Only a hosted build gets the production values. The standalone file and
  // `npm run dev` stay in local mode unless you set the variables yourself.
  if (command === 'build' && !single) {
    for (const [key, value] of Object.entries(PRODUCTION)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }

  return {
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
};
});
