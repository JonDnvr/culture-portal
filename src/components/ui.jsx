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
export function Tag({ type = 'plain', onClick, title, children }) {
  return (
    <span className={`tag tg-${type}${onClick ? ' btn2' : ''}`} title={title} onClick={onClick}>
      {children}
    </span>
  );
}

export function CategoryBadge({ name }) {
  if (!name) return null;
  return <Tag type="category">{name}</Tag>;
}

/** The standard run of tags for a behavior, in the standard order. */
export function BehaviorTags({ behavior, rituals = [], showCounts = true, onSystem }) {
  const systems = behavior.placements ?? [];
  const applied = [...rituals.filter((r) => r.applies_to_all), ...(behavior.rituals ?? []).filter((r) => !r.applies_to_all)];
  return (
    <>
      {(behavior.values ?? []).map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
      <Tag type="category">{behavior.category}</Tag>
      {showCounts && <Tag type="ritual">Rituals ({applied.length})</Tag>}
      {showCounts && (systems.length
        ? <Tag type="system" onClick={onSystem}>{systems.map((p) => p.system).join(', ')}</Tag>
        : <Tag type="warn">No system</Tag>)}
      {showCounts && systems.length === 1 && <Tag type="warn">Thin support</Tag>}
    </>
  );
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
