import React, { useEffect, useRef, useState } from 'react';
import { renderRich } from '../lib/format.js';

/**
 * A formatted text box: Bold, Italic, List and Link, shown as they will look.
 *
 * What is saved is still the plain marks of lib/format.js (**bold**, *italic*,
 * "- " lists, [words](url), blank lines between paragraphs), so stored text,
 * emails and older posts are unchanged. The box turns those marks into
 * formatting when it opens and turns its contents back into marks as you type.
 */
export function RichTextArea({ id, value, onChange, rows = 5, placeholder }) {
  const box = useRef(null);
  const emitted = useRef(null);        // the last value this box produced
  const saved = useRef(null);          // the selection, kept while the link row has focus
  const [linking, setLinking] = useState(null);   // { url, hasText } while the link row is open

  // Load the text when it arrives from outside (opening a form, a reset), but
  // never while it is the echo of what was just typed, or the caret would jump.
  useEffect(() => {
    const el = box.current;
    if (!el || value === emitted.current) return;
    el.innerHTML = renderRich(value ?? '');
    emitted.current = value;
  }, [value]);

  const emit = () => {
    const marks = toMarks(box.current);
    emitted.current = marks;
    onChange(marks);
  };

  const run = (cmd, arg) => {
    box.current?.focus();
    try { document.execCommand('styleWithCSS', false, false); } catch { /* older browsers */ }
    document.execCommand(cmd, false, arg);
    emit();
  };

  function openLink() {
    const s = window.getSelection();
    const inBox = s.rangeCount && box.current.contains(s.anchorNode);
    saved.current = inBox ? s.getRangeAt(0).cloneRange() : null;
    setLinking({ url: '', hasText: !!(inBox && !s.isCollapsed) });
  }

  function addLink() {
    const url = linking.url.trim();
    setLinking(null);
    if (!url) return;
    const full = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    const el = box.current;
    el.focus();
    const s = window.getSelection();
    s.removeAllRanges();
    if (saved.current) s.addRange(saved.current);
    else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); s.addRange(r); }
    if (!s.isCollapsed) run('createLink', full);
    else run('insertHTML', `<a href="${escAttr(full)}">${escAttr(full)}</a>&nbsp;`);
  }

  return (
    <div className="richbox">
      <div className="richbar" role="toolbar" aria-label="Formatting">
        {/* mousedown is held back so the selection stays in the text */}
        <button type="button" className="rb" title="Bold (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => run('bold')}><b>B</b></button>
        <button type="button" className="rb" title="Italic (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => run('italic')}><i>I</i></button>
        <button type="button" className="rb" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertUnorderedList')}>• List</button>
        <button type="button" className="rb" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={openLink}>Link</button>
        <span className="richhint">Enter starts a new paragraph.</span>
      </div>
      {linking && (
        <div className="richlink">
          <input type="url" autoFocus placeholder={linking.hasText ? 'Link the selected words to https://…' : 'https://…'} value={linking.url}
            onChange={(e) => setLinking({ ...linking, url: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } if (e.key === 'Escape') { e.stopPropagation(); setLinking(null); } }} />
          <button type="button" className="btn small" onClick={addLink}>Add link</button>
          <button type="button" className="btn ghost small" onClick={() => setLinking(null)}>Cancel</button>
        </div>
      )}
      <div id={id} ref={box} className="richedit rich" contentEditable suppressContentEditableWarning
        role="textbox" aria-multiline="true" aria-label={placeholder || 'Text'}
        data-placeholder={placeholder || ''} data-empty={!value ? 'true' : 'false'}
        style={{ minHeight: `${Math.max(2, rows) * 1.55}em` }}
        onFocus={() => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* fine */ } }}
        onInput={emit}
        // Pasted text arrives plain, so other sites' styling never comes along.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          emit();
        }} />
    </div>
  );
}

/** Formatted text, from the same marks. Safe: renderRich escapes everything first. */
export function Rich({ text, className = '' }) {
  return <div className={`rich ${className}`.trim()} dangerouslySetInnerHTML={{ __html: renderRich(text) }} />;
}

const escAttr = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const BLOCKS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);

/** A mark around words, outside any spaces at either end and line by line. */
function mark(m, s) {
  return s.split('\n').map((line) => {
    const core = line.trim();
    if (!core) return line;
    const lead = line.match(/^\s*/)[0];
    const trail = line.match(/\s*$/)[0];
    return `${lead}${m}${core}${m}${trail}`;
  }).join('\n');
}

function inline(n) {
  if (n.nodeType === 3) return n.nodeValue.replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ');
  if (n.nodeType !== 1) return '';
  const tag = n.tagName;
  if (tag === 'BR') return '\n';
  const inner = Array.from(n.childNodes).map(inline).join('');
  const bold = tag === 'B' || tag === 'STRONG' || (tag === 'SPAN' && (n.style.fontWeight === 'bold' || Number(n.style.fontWeight) >= 600));
  const italic = tag === 'I' || tag === 'EM' || (tag === 'SPAN' && n.style.fontStyle === 'italic');
  if (tag === 'A') {
    const href = n.getAttribute('href') ?? '';
    const flat = inner.replace(/\s+/g, ' ');
    const words = flat.trim();
    if (!SAFE_URL.test(href) || !words) return inner;
    // A space selected along with the words stays outside the link.
    const lead = flat.match(/^\s*/)[0];
    const trail = flat.match(/\s*$/)[0];
    return `${lead}${words === href ? href : `[${words}](${href})`}${trail}`;
  }
  let out = inner;
  if (italic) out = mark('*', out);
  if (bold) out = mark('**', out);
  return out;
}

/** The editor's contents as the plain marks lib/format.js reads. */
function toMarks(root) {
  if (!root) return '';
  const blocks = [];
  let line = '';
  const end = () => {
    const t = line.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
    if (t.trim()) blocks.push(t);
    line = '';
  };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 1 && BLOCKS.has(c.tagName)) {
        end();
        if (c.tagName === 'UL' || c.tagName === 'OL') {
          const items = Array.from(c.children).filter((li) => li.tagName === 'LI')
            .map((li) => inline(li).replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((t) => `- ${t}`);
          if (items.length) blocks.push(items.join('\n'));
        } else walk(c);
        end();
      } else line += inline(c);
    }
  };
  walk(root);
  end();
  return blocks.join('\n\n');
}
