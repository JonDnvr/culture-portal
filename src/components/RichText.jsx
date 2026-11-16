import React, { useRef, useState } from 'react';
import { renderRich } from '../lib/format.js';

/**
 * A text box with a small toolbar: Bold, Italic, List and Link. The marks it
 * adds are plain text (see lib/format.js), so what is saved stays readable
 * anywhere and is formatted where it is shown.
 */
export function RichTextArea({ id, value, onChange, rows = 5, placeholder }) {
  const box = useRef(null);
  const [linking, setLinking] = useState(null);   // { start, end, url } while the link row is open

  const sel = () => {
    const el = box.current;
    return { el, start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  };
  // Replace a stretch of the text and put the selection where it belongs.
  const splice = (start, end, insert, selStart, selEnd) => {
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  };

  function wrap(mark) {
    const { start, end } = sel();
    const text = value.slice(start, end) || (mark === '**' ? 'bold text' : 'italic text');
    splice(start, end, `${mark}${text}${mark}`, start + mark.length, start + mark.length + text.length);
  }

  // Turns the selected lines into a list, or back into plain lines.
  function list() {
    const { start, end } = sel();
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const toNl = value.indexOf('\n', end);
    const to = toNl === -1 ? value.length : toNl;
    const lines = value.slice(from, to).split('\n');
    const on = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    const next = lines.map((l) => (on ? l.replace(/^\s*[-*•]\s+/, '') : `- ${l}`)).join('\n');
    splice(from, to, next, from, from + next.length);
  }

  function addLink() {
    const url = linking.url.trim();
    if (!url) { setLinking(null); return; }
    const full = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    const words = value.slice(linking.start, linking.end) || full;
    const insert = `[${words}](${full})`;
    splice(linking.start, linking.end, insert, linking.start, linking.start + insert.length);
    setLinking(null);
  }

  return (
    <div className="richbox">
      <div className="richbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="rb" title="Bold" onClick={() => wrap('**')}><b>B</b></button>
        <button type="button" className="rb" title="Italic" onClick={() => wrap('*')}><i>I</i></button>
        <button type="button" className="rb" title="Bulleted list" onClick={list}>• List</button>
        <button type="button" className="rb" title="Link" onClick={() => { const { start, end } = sel(); setLinking({ start, end, url: '' }); }}>Link</button>
        <span className="richhint">A blank line starts a new paragraph.</span>
      </div>
      {linking && (
        <div className="richlink">
          <input type="url" autoFocus placeholder="https://…" value={linking.url}
            onChange={(e) => setLinking({ ...linking, url: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } if (e.key === 'Escape') { e.stopPropagation(); setLinking(null); } }} />
          <button type="button" className="btn small" onClick={addLink}>Add link</button>
          <button type="button" className="btn ghost small" onClick={() => setLinking(null)}>Cancel</button>
        </div>
      )}
      <textarea id={id} ref={box} rows={rows} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Formatted text, from the same marks. Safe: renderRich escapes everything first. */
export function Rich({ text, className = '' }) {
  return <div className={`rich ${className}`.trim()} dangerouslySetInnerHTML={{ __html: renderRich(text) }} />;
}
