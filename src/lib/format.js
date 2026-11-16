/**
 * Formatted text for stories, recognition and email notes (R7.2).
 *
 * People write plain text with a few marks, which the editor's toolbar adds:
 *
 *   a blank line          starts a new paragraph
 *   **bold**  *italic*    emphasis
 *   - item                a bullet list (every line of the paragraph)
 *   [words](https://…)    a link; a bare https:// address links itself too
 *
 * renderRich turns that into HTML. Everything is escaped first, so the only
 * tags in the result are the ones made here, and links must be http(s) or
 * mailto. The same file is copied to supabase/functions/_shared/format.js for
 * the emails; change them together.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const BULLET = /^\s*[-*•]\s+/;

/** Inline styles for email, where class names do nothing. Empty in the portal. */
const attr = (style) => (style ? ` style="${style}"` : '');

function link(url, text, st) {
  return `<a href="${url}"${attr(st.a)} target="_blank" rel="noopener noreferrer">${text}</a>`;
}

/** Marks inside one line of already-escaped text. */
function inline(s, st) {
  // [words](url): the url arrives escaped, so &amp; is put back before checking it.
  // Only &amp; may appear in an address: a typed quote or bracket ends it.
  let out = s.replace(/\[([^\]\n]+)\]\(((?:[^)\s&]|&amp;)+)\)/g, (m, text, url) =>
    (SAFE_URL.test(url.replace(/&amp;/g, '&')) ? link(url, text, st) : m));
  // A bare address, not already inside a link made above.
  out = out.replace(/(^|[\s(])(https?:\/\/(?:[^\s<&]|&amp;)*[^\s<&.,;:!?)])/g, (m, pre, url) => `${pre}${link(url, url, st)}`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

/**
 * Formatted HTML from marked-up text. `styles` ({ p, ul, li, a }) adds inline
 * styles for email.
 */
export function renderRich(text, styles = {}) {
  const st = styles ?? {};
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  return blocks.filter((b) => b.trim()).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim());
    if (lines.length && lines.every((l) => BULLET.test(l))) {
      const items = lines.map((l) => `<li${attr(st.li)}>${inline(esc(l.replace(BULLET, '')), st)}</li>`).join('');
      return `<ul${attr(st.ul)}>${items}</ul>`;
    }
    return `<p${attr(st.p)}>${lines.map((l) => inline(esc(l), st)).join('<br>')}</p>`;
  }).join('');
}

/** The same text without its marks, for previews, search and plain-text email. */
export function plainText(text) {
  return String(text ?? '')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1$2')
    .replace(/^\s*[-*•]\s+/gm, '• ');
}
