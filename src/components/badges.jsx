import React from 'react';

/**
 * The award marks. One icon per section (Clarity, Cadence, Connection,
 * Conviction), drawn in currentColor so they take the organization's accent,
 * and every trophy built from its section's icon. Gold means earned: only a
 * star, a seal or a crest is ever solid gold.
 */

const STROKE = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round', strokeLinejoin: 'round'
};

/* ------------------------------------------------------------ section marks */

export function Lens({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="3" />
      <path d="M12 1.7v2.5M12 19.8v2.5M1.7 12h2.5M19.8 12h2.5" />
    </svg>
  );
}

/** A metronome: trapezoid body, base, and an arm that breaks the top. */
export function Metronome({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M9.6 8.2h4.8l4 10.4H5.6z" /><path d="M4.2 18.6h15.6" />
      <path d="M11.6 16.6 16.8 3.6" /><circle cx="15.4" cy="7.2" r="1.6" />
    </svg>
  );
}

export function Nodes({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <circle cx="7.2" cy="7.4" r="3.6" /><circle cx="16.8" cy="16.6" r="3.6" />
      <path d="M9.7 9.9C11.3 11.2 12.8 12.7 14.3 14.1" strokeWidth="2" />
    </svg>
  );
}

const STONES = [[4.3, 17, 15.4, 3.8], [6.5, 12.1, 11, 3.8], [8.6, 7.8, 6.8, 3.4], [10.3, 3.6, 3.4, 3.2]];

export function Cairn({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      {STONES.map(([x, y, w, h]) => <rect key={y} x={x} y={y} width={w} height={h} rx={h / 2} />)}
    </svg>
  );
}

export function Converge({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M12 3.5v17" /><path d="M4 7.6 8.4 12 4 16.4" /><path d="M20 7.6 15.6 12 20 16.4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ awards */

/** The practice streak. The number inside is weeks in a row. */
export function Flame({ n, size = 58 }) {
  return (
    <span className="flame" style={{ width: size, height: size * 1.08 }}>
      <svg viewBox="0 0 74 80" aria-hidden="true">
        <path d="M37 4C33 17 22 22 18 34c-4 11-1 24 7 32 4 5 8 8 12 10 4-2 8-5 12-10 8-8 11-21 7-32-3-9-10-14-13-22-1 7-3 11-6 14 2-7 2-15 0-22z" />
      </svg>
      <span className="count" style={{ fontSize: size * 0.34, top: size * 0.36 }}>{n}</span>
    </span>
  );
}

/**
 * The Cadence Seal: a metronome inside twelve notches, one per month of the
 * run, so a full ring is a year. The face fills solid only at a full year.
 */
export function Seal({ size = 46, months = 0, tier = 1 }) {
  const notches = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2, on = i < months;
    return (
      <line key={i}
        x1={(36 + Math.cos(a) * 30).toFixed(1)} y1={(36 + Math.sin(a) * 30).toFixed(1)}
        x2={(36 + Math.cos(a) * 25.6).toFixed(1)} y2={(36 + Math.sin(a) * 25.6).toFixed(1)}
        stroke={on ? 'var(--gold-bright)' : 'var(--gold-line)'} strokeWidth={on ? 2.6 : 1.4}
        strokeLinecap="round" opacity={on ? 1 : 0.55} />
    );
  });
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" className="seal">
      <circle cx="36" cy="36" r="33" fill="none" stroke="var(--gold-line)" strokeWidth="1.2" />
      <circle cx="36" cy="36" r="24.5" fill={tier >= 4 ? 'var(--gold-bright)' : 'var(--gold-wash)'}
        stroke="var(--gold-bright)" strokeWidth={tier >= 3 ? 2.2 : 1.4} />
      {tier >= 3 && (
        <circle cx="36" cy="36" r="20.5" fill="none" stroke={tier >= 4 ? 'var(--on-gold)' : 'var(--gold-line)'}
          strokeWidth="1" opacity={tier >= 4 ? 0.45 : 1} />
      )}
      {notches}
      <g transform="translate(36 37) scale(1.15) translate(-12 -12)"
        {...STROKE} stroke={tier >= 4 ? 'var(--on-gold)' : 'var(--gold)'}>
        <path d="M9.6 8.2h4.8l4 10.4H5.6z" /><path d="M4.2 18.6h15.6" />
        <path d="M11.6 16.6 16.8 3.6" /><circle cx="15.4" cy="7.2" r="1.6" />
      </g>
    </svg>
  );
}

/** A recognition one member gave another. The only thing that earns one. */
export function GoldStar({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <path d="M17 3.5l4.05 8.2 9.05 1.32-6.55 6.38 1.55 9.02L17 24.16 8.9 28.42l1.55-9.02L3.9 13.02l9.05-1.32z"
        fill="var(--gold-bright)" stroke="var(--gold)" strokeWidth="1" />
    </svg>
  );
}

/** A Value award from a leader. One pip on the chief band per Value it stands for. */
export function Crest({ height = 50, pips = 1 }) {
  const gap = 11, start = 33 - ((pips - 1) * gap) / 2;
  return (
    <svg width={Math.round((height * 66) / 80)} height={height} viewBox="0 0 66 80" aria-hidden="true">
      <path d="M6 8h54v34c0 16-11 27-27 34C22 69 6 58 6 42z" fill="var(--gold-wash)"
        stroke="var(--gold-bright)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M6 8h54v20H6z" fill="var(--gold-bright)" opacity=".22" />
      <path d="M6 28h54" stroke="var(--gold-bright)" strokeWidth="1.8" />
      {Array.from({ length: pips }, (_, i) => (
        <circle key={i} cx={(start + i * gap).toFixed(1)} cy="18" r="3.5"
          fill="var(--gold-bright)" stroke="var(--gold)" strokeWidth="1" />
      ))}
    </svg>
  );
}

/** The next pulse round, filling from the bottom as answers come in. */
export function CairnStack({ size = 38, filled = 0 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {STONES.map(([x, y, w, h], i) => {
        const on = i < filled;
        return (
          <rect key={y} x={x} y={y} width={w} height={h} rx={h / 2}
            fill={on ? 'var(--gold-bright)' : 'none'} stroke={on ? 'var(--gold)' : 'var(--gold-line)'}
            strokeWidth="1.6" opacity={on ? 1 : 0.6} />
        );
      })}
    </svg>
  );
}

/** A finished pulse round. The number on the base stone counts rounds. */
export function CairnDone({ size = 38, rounds }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {STONES.map(([x, y, w, h]) => (
        <rect key={y} x={x} y={y} width={w} height={h} rx={h / 2}
          fill="var(--gold-bright)" stroke="var(--gold)" strokeWidth="1.4" />
      ))}
      <circle cx="12" cy="18.9" r="4.3" fill="var(--gold)" stroke="var(--gold-wash)" strokeWidth="1.3" />
      <text x="12" y="21" textAnchor="middle" fontSize="5.6" fontWeight="700"
        fontFamily="Archivo, sans-serif" fill="var(--gold-wash)">{rounds}</text>
    </svg>
  );
}

export function Medal({ size = 44, solid = false, children }) {
  return (
    <span className={`medal ${solid ? 'solid' : 'wash'}`} style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- fluency */

/** Four quarters that always fill clockwise from the top, whichever steps are done. */
export function FluencyRing({ done, size = 48 }) {
  const r = 17, c = 2 * Math.PI * r, seg = c / 4, dash = seg - 4;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 46 46">
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx="23" cy="23" r={r} fill="none" strokeWidth="5"
            stroke={i < done ? 'var(--spruce)' : 'var(--line)'}
            strokeDasharray={`${dash.toFixed(2)} ${(c - dash).toFixed(2)}`}
            strokeDashoffset={(-i * seg).toFixed(2)} />
        ))}
      </svg>
      <span className="pct">{done * 25}%</span>
    </span>
  );
}

/** Ring while in progress, wash medal at Foundation Fluent, solid at Fully Fluent. */
export function FluencyBadge({ f, size = 48 }) {
  if (f.full) return <Medal size={size} solid><Lens size={Math.round(size * 0.48)} /></Medal>;
  if (f.fluent) return <Medal size={size}><Lens size={Math.round(size * 0.48)} /></Medal>;
  return <FluencyRing done={f.done} size={size} />;
}

export const fluencyName = (f, term) =>
  f.full ? 'Fully Fluent' : f.fluent ? `${term?.One ?? 'Foundation'} Fluent` : 'Fluency ring';

/** Oldest week first, one dot per week of the recent window. */
export function WeekMarks({ marks }) {
  return (
    <span className="ofdots">
      {marks.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
    </span>
  );
}

/* ---------------------------------------------------------- navigation */

/**
 * The section marks double as the navigation icons, so Clarity, Cadence,
 * Connection and Conviction look the same in the menu as on their badges.
 */
export function NavIcon({ id, size = 18 }) {
  switch (id) {
    case 'home':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
          <path d="M3.5 10.5 12 3.8l8.5 6.7" /><path d="M5.8 9v11h12.4V9" /><path d="M10 20v-5.5h4V20" />
        </svg>
      );
    case 'clarity': return <Lens size={size} />;
    case 'cadence': return <Metronome size={size} />;
    case 'connection': return <Nodes size={size} />;
    case 'conviction': return <Cairn size={size} />;
    case 'wall':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
          <path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 5.5H4.2v1.2A3.2 3.2 0 0 0 7.4 10" />
          <path d="M17 5.5h2.8v1.2A3.2 3.2 0 0 1 16.6 10" /><path d="M12 14v4.2" /><path d="M8.5 20.2h7" />
        </svg>
      );
    case 'admin':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
          <path d="M4 7h9" /><path d="M17 7h3" /><circle cx="15" cy="7" r="2" />
          <path d="M4 17h3" /><path d="M11 17h9" /><circle cx="9" cy="17" r="2" />
        </svg>
      );
    default: return null;
  }
}
