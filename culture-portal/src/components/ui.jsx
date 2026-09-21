import React, { useCallback, useEffect } from 'react';

export const pad = (n) => String(n).padStart(2, '0');

/**
 * A behavior's number reads as part of its title: same size, same weight,
 * accent colored, on the same line.
 */
export function BNum({ n }) {
  return <span className="bnum">{pad(n)}.</span>;
}

/** A behavior referenced from somewhere else, tagged in the accent color. */
export function BehaviorTag({ behavior, onClick }) {
  if (!behavior) return null;
  return (
    <Tag type="behavior" onClick={onClick}>
      {pad(behavior.number)}. {behavior.title}
    </Tag>
  );
}

/**
 * One tag component for everything we hang off a behavior, colored by what
 * kind of thing it is rather than by its value: values gold, categories sage,
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
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
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

/** Minimal toast: no dependency, no provider, disappears on its own. */
export function useToast() {
  return useCallback((message) => {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
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
