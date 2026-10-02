import React, { useEffect, useMemo, useState } from 'react';

const PAGE = 10;

/**
 * The same three controls on every activity list: your team or the whole
 * organization, a search, and ten at a time with "See more".
 *
 * Search always looks across the whole organization, whatever the toggle
 * says: someone searching for a name wants every match, not only their team's.
 * Every word typed has to appear somewhere in the record.
 */
export function useListTools({ ctx, rows, onTeam, text }) {
  const team = ctx.teams.find((t) => t.id === ctx.myTeamId) ?? null;
  const [scope, setScope] = useState('org');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => { setLimit(PAGE); }, [scope, q, rows.length]);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      return rows.filter((r) => {
        const hay = text(r).toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    if (scope === 'team' && team) return rows.filter((r) => onTeam(r, team.id));
    return rows;
  }, [rows, q, scope, team?.id]);

  return {
    team, scope: team ? scope : 'org', setScope, q, setQ,
    searching: !!q.trim(),
    shown: filtered.slice(0, limit),
    total: filtered.length,
    hasMore: filtered.length > limit,
    more: () => setLimit((n) => n + PAGE)
  };
}

export function ListBar({ ctx, tools, placeholder, children }) {
  const { team } = tools;
  return (
    <>
      <div className="listbar">
        <input type="search" className="searchbox" placeholder={placeholder ?? 'Search everything in the organization'}
          value={tools.q} onChange={(e) => tools.setQ(e.target.value)} aria-label="Search" />
        {team && (
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={tools.scope === 'org'} onClick={() => tools.setScope('org')}
              disabled={tools.searching}>{ctx.org.name}</button>
            <button aria-pressed={tools.scope === 'team'} onClick={() => tools.setScope('team')}
              disabled={tools.searching}>{team.name}</button>
          </div>
        )}
        {children}
      </div>
      <p className="searchnote">
        {tools.searching
          ? `${tools.total} match${tools.total === 1 ? '' : 'es'} across ${ctx.org.name}`
          : `Showing ${Math.min(tools.shown.length, tools.total)} of ${tools.total}${tools.scope === 'team' && team ? ` for ${team.name}` : ''}, newest first`}
      </p>
    </>
  );
}

export function MoreButton({ tools }) {
  if (!tools.hasMore) return null;
  return (
    <div className="moreline">
      <button className="btn ghost" onClick={tools.more}>See more</button>
    </div>
  );
}

/** Everything a person might type to find a record, flattened to one string. */
export function searchable(ctx, parts) {
  return parts.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== '').join(' • ');
}

/** A behavior as it is searched for: its number, with and without padding, and its title. */
export function behaviorWords(b) {
  if (!b) return [];
  return [String(b.number), String(b.number).padStart(2, '0'), b.title, ...(b.values ?? []).map((v) => v.name), b.category];
}
