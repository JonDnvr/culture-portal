/**
 * Inlines the built CSS and JS into one HTML file that opens straight from
 * disk, no server required.
 *
 *   npm run build:single   ->   dist-single/culture-portal.html
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const dir = 'dist-single';
const html = await readFile(join(dir, 'index.html'), 'utf8');
const js = await readFile(join(dir, 'app.js'), 'utf8');
let css = '';
try { css = await readFile(join(dir, 'app.css'), 'utf8'); } catch { /* no css emitted */ }

// Replacement callbacks, not strings: bundled code contains $& and $1
// sequences that String.replace would otherwise expand.
const out = html
  .replace(/<script[^>]*src="[^"]*app\.js"[^>]*><\/script>/, () => '')
  .replace(/<link[^>]*href="[^"]*app\.css"[^>]*>/, () => (css ? `<style>\n${css}\n</style>` : ''))
  .replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);

await writeFile(join(dir, 'culture-portal.html'), out);
await rm(join(dir, 'index.html'));
await rm(join(dir, 'app.js'));
await rm(join(dir, 'app.css'), { force: true });
// The Cloudflare Pages files belong to the hosted build, not this one.
await rm(join(dir, '_headers'), { force: true });
await rm(join(dir, '_redirects'), { force: true });

console.log(`dist-single/culture-portal.html  (${(out.length / 1024).toFixed(0)} kB) — open it in any browser.`);
