import React, { useCallback, useEffect, useRef, useState } from 'react';

export const pad = (n) => String(n).padStart(2, '0');

/**
 * A behavior's number reads as part of its title: same size, same weight,
 * accent colored, on the same line.
 */
export function BNum({ n }) {
  return <span className="bnum">{pad(n)}.</span>;
}

/** A behavior number anywhere it sits inside other text: always bold. */
export function N({ n, dot = true }) {
  return <b className="bn">{pad(n)}{dot ? '.' : ''}</b>;
}

/** A comma-separated run of bold behavior numbers. */
export function NumList({ items }) {
  return items.map((x, i) => (
    <React.Fragment key={x.id ?? i}>{i > 0 && ', '}<N n={x.number} dot={false} /></React.Fragment>
  ));
}

const initialsOf = (name) =>
  String(name ?? '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/**
 * A member's picture as a small circle, or their initials when they have not
 * added one. Shown wherever a person acts or is recognized.
 */
export function Avatar({ person, name, size = 22 }) {
  const label = person?.display_name ?? name ?? '';
  const style = { width: size, height: size, flex: `0 0 ${size}px` };
  if (person?.avatar_url) {
    return <img className="avatar" src={person.avatar_url} alt="" title={label} style={style} />;
  }
  return (
    <span className="avatar initials" title={label} aria-hidden="true"
      style={{ ...style, fontSize: Math.max(8, Math.round(size * 0.4)) }}>
      {initialsOf(label)}
    </span>
  );
}

/** Picture and name together, for bylines and lists. */
export function Who({ person, name, size = 22, children }) {
  return (
    <span className="who2">
      <Avatar person={person} name={name} size={size} />
      <span>{children ?? person?.display_name ?? name}</span>
    </span>
  );
}

/**
 * Finds the person behind a record: by id when the record has one, otherwise
 * by exact name, which is all older recognition and the seed data carry.
 */
export function findPerson(people, { id, name } = {}) {
  if (!people?.length) return null;
  if (id) { const p = people.find((x) => x.user_id === id); if (p) return p; }
  if (name) return people.find((x) => x.display_name === name) ?? null;
  return null;
}

/** A behavior referenced from somewhere else, tagged in the accent color. */
export function BehaviorTag({ behavior, onClick }) {
  if (!behavior) return null;
  return (
    <Tag type="behavior" onClick={onClick}>
      <N n={behavior.number} /> {behavior.title}
    </Tag>
  );
}

/**
 * One tag component for everything we hang off a behavior, colored by what
 * kind of thing it is rather than by its value: values burnt orange, categories sage,
 * rituals grape, systems blue, warnings red. Tags always follow the name they
 * belong to, in that order.
 */
export function Tag({ type = 'plain', onClick, title, children, behaviorId }) {
  // Values and categories open their definition; a behavior's ritual and
  // system tags open that list, filtered to the behavior.
  const auto = !onClick && tagActions && (
    ((type === 'value' || type === 'category') && typeof children === 'string' && tagActions.knows(type, children)) ||
    ((type === 'ritual' || type === 'system') && behaviorId));
  const click = onClick ?? (auto ? (e) => { e.stopPropagation(); tagActions(type, children, behaviorId); } : undefined);
  const hint = title ?? (auto ? {
    value: 'What this value means', category: 'What this category means',
    ritual: 'Show the rituals for this behavior', system: 'Show the systems for this behavior'
  }[type] : undefined);
  return (
    <span className={`tag tg-${type}${click ? ' btn2' : ''}`} title={hint} onClick={click}
      role={click ? 'button' : undefined} tabIndex={click ? 0 : undefined}
      onKeyDown={click ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(e); } } : undefined}>
      {children}
    </span>
  );
}

let tagActions = null;

/**
 * Mounted once in the app shell. Gives every Tag its action, and shows the
 * definition of a value or a 5C category when one is clicked.
 */
export function TagActionsHost({ ctx }) {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const valueNames = new Set((ctx.values ?? []).map((v) => v.name));
    const catNames = new Set((ctx.categories ?? []).map((c) => c.name));
    tagActions = (type, name, behaviorId) => {
      if (type === 'ritual' || type === 'system') {
        ctx.openList(type === 'ritual' ? 'rituals' : 'systems', behaviorId);
        return;
      }
      setOpen({ type, name });
    };
    // Only real value and category names are clickable, not status labels
    // that happen to share a tag color.
    tagActions.knows = (type, name) => (type === 'value' ? valueNames : catNames).has(name);
    return () => { tagActions = null; };
  }, [ctx.goto]);
  if (!open) return null;
  const close = () => setOpen(null);
  const { values = [], categories = [], behaviors = [], term, showCats } = ctx;

  if (open.type === 'value') {
    const v = values.find((x) => x.name === open.name);
    const carried = behaviors.filter((b) => (b.values ?? []).some((x) => x.name === open.name));
    return (
      <Modal title={open.name} onClose={close} footer={<button className="btn ghost" onClick={close}>Close</button>}>
        <div className="tagrow"><span className="tag tg-value">Value</span>{showCats && v?.category && <Tag type="category">{v.category}</Tag>}</div>
        <p className="confirmbody">{v?.description || 'No description written yet.'}</p>
        <label className="fl">{term.Many} that carry it ({carried.length})</label>
        <ul className="vlist">
          {carried.map((b) => (
            <li key={b.id}><button className="linkbtn" onClick={() => { close(); ctx.openBehavior(b.id); }}><N n={b.number} /> {b.title}</button></li>
          ))}
          {!carried.length && <li className="quiet">None yet.</li>}
        </ul>
      </Modal>
    );
  }
  const c = categories.find((x) => x.name === open.name);
  const inVals = values.filter((x) => x.category === open.name);
  const inBeh = behaviors.filter((b) => b.category === open.name);
  return (
    <Modal title={open.name} onClose={close} footer={<button className="btn ghost" onClick={close}>Close</button>}>
      <div className="tagrow"><span className="tag tg-category">5C category</span></div>
      {c?.question && <p className="ratinghead">{c.question}</p>}
      <p className="confirmbody">{c?.definition ?? ''}</p>
      {inVals.length > 0 && <>
        <label className="fl">Values in it</label>
        <p className="confirmbody">{inVals.map((x) => x.name).join(', ')}</p>
      </>}
      <label className="fl">{term.Many} in it ({inBeh.length})</label>
      <ul className="vlist">
        {inBeh.map((b) => (
          <li key={b.id}><button className="linkbtn" onClick={() => { close(); ctx.openBehavior(b.id); }}><N n={b.number} /> {b.title}</button></li>
        ))}
        {!inBeh.length && <li className="quiet">None yet.</li>}
      </ul>
    </Modal>
  );
}

export function CategoryBadge({ name }) {
  if (!name) return null;
  return <Tag type="category">{name}</Tag>;
}


export function Modal({ title, children, footer, onClose, wide }) {
  const scrim = useRef(null);
  useEffect(() => {
    // Escape closes only the dialog on top, so a confirmation over a form
    // does not take the form with it.
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      const all = document.querySelectorAll('.scrim');
      if (all[all.length - 1] === scrim.current) onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="scrim" ref={scrim} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="form">
          {title && <h3>{title}</h3>}
          {children}
        </div>
        {footer && <div className="modalfoot">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ confirmation */

let showConfirm = null;

/**
 * Asks before anything is removed. Resolves true only when the person presses
 * the action button; Cancel, Escape or a click outside all mean no.
 *
 *   if (!(await confirmAction({ title: 'Delete this story?', body: '…' }))) return;
 */
export function confirmAction({ title, body = 'This cannot be undone.', action = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    if (showConfirm) showConfirm({ title, body, action, danger, resolve });
    else resolve(window.confirm(`${title}\n\n${body}`));
  });
}

/** Mounted once, in the app shell. */
export function ConfirmHost() {
  const [c, setC] = useState(null);
  useEffect(() => { showConfirm = setC; return () => { showConfirm = null; }; }, []);
  if (!c) return null;
  const done = (yes) => { setC(null); c.resolve(yes); };
  return (
    <Modal title={c.title} onClose={() => done(false)}
      footer={<>
        <button className="btn ghost" onClick={() => done(false)} autoFocus>Cancel</button>
        <button className={c.danger ? 'btn danger' : 'btn'} onClick={() => done(true)}>{c.action}</button>
      </>}>
      <p className="confirmbody">{c.body}</p>
    </Modal>
  );
}

/** Minimal toast: no dependency, no provider, disappears on its own. */
export function useToast() {
  return useCallback((message, ms = 3500) => {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }, []);
}

export function PulseBar({ score, spread }) {
  const pct = (score / 5) * 100;
  const lo = Math.max(0, ((score - spread / 2) / 5) * 100);
  const w = Math.min(100 - lo, (spread / 5) * 100);
  return (
    <div className="bar">
      <div className="fill" style={{ width: `${pct}%` }} />
      <div className="spread" style={{ left: `${lo}%`, width: `${w}%` }} />
    </div>
  );
}

/** The organization's logo when it has one, otherwise its initials in its color. */
export function OrgMark({ org }) {
  if (org?.logo_url) return <img className="orglogo" src={org.logo_url} alt={`${org.name} logo`} />;
  return <span className="chip" style={{ background: org?.accent }}>{org?.initials}</span>;
}
