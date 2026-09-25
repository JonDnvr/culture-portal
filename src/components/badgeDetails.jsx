import React, { useMemo } from 'react';
import {
  sessionRitualId, recentWeeks, practicedByBehavior, connectionByBehavior, fluencyFor,
  FLUENCY_STEPS, weekKey, lastWeeks
} from '../lib/gamify.js';
import { Modal, N, Avatar, findPerson } from './ui.jsx';
import { FluencyBadge, fluencyName, Medal, Metronome, Nodes, WeekMarks } from './badges.jsx';

/**
 * Per-behavior badges for the person looking: their own fluency, and their
 * team's practice and connection (the organization's when they have no team).
 */
export function useBehaviorBadges(ctx) {
  const { org, behaviors, rituals, activity, people, userId, myTeamId, teams } = ctx;
  return useMemo(() => {
    const sessionId = sessionRitualId(rituals);
    const team = teams.find((t) => t.id === myTeamId);
    const scope = team ? { kind: 'team', teamId: team.id } : { kind: 'org' };
    const scopeName = team ? team.name : org.name;
    const rw = recentWeeks(org);
    const recentDays = org.recent_days ?? 45;
    const practiced = practicedByBehavior(activity.iterations, behaviors, sessionId, scope, rw);
    const connection = connectionByBehavior(activity.recognitions, activity.stories, people, scope, recentDays);
    const fluency = Object.fromEntries(behaviors.map((b) => [b.id, fluencyFor(b, {
      marks: activity.fluencyMarks, iterations: activity.iterations,
      recognitions: activity.recognitions, stories: activity.stories,
      userId, teamId: myTeamId, sessionId
    })]));
    return { sessionId, scope, scopeName, rw, recentDays, practiced, connection, fluency };
  }, [org, behaviors, rituals, activity, people, userId, myTeamId, teams]);
}

const Tick = ({ on, gold }) => (
  <span className={`tick${on ? (gold ? ' gold' : ' on') : ''}`}>
    {on && (
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M1.5 5.2l2.3 2.3 4.7-5" fill="none" stroke={gold ? 'var(--on-gold)' : 'var(--paper)'} strokeWidth="1.8" />
      </svg>
    )}
  </span>
);

function Shell({ art, kicker, title, status, how, children, onClose, term }) {
  return (
    <Modal title={title} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      <div className="badgehead">
        <span className="badgeart">{art}</span>
        <span>
          <span className="kicker2">{kicker}</span>
          <span className="badgestatus">{status}</span>
        </span>
      </div>
      <h4 className="fl">How it is earned</h4>
      <p className="badgehow">{how}</p>
      {children}
      <p className="meta badgefoot">Badge details. To open the {term?.one ?? 'behavior'} itself, use its title.</p>
    </Modal>
  );
}

export function FluencyDetail({ ctx, behavior, f, onClose }) {
  const open = (rec) => { onClose(); ctx.openRecord(rec.kind, rec.id); };
  return (
    <Shell onClose={onClose} term={ctx.term} art={<FluencyBadge f={f} size={56} />} kicker="Clarity"
      title={fluencyName(f, ctx.term)}
      status={<><N n={behavior.number} /> {behavior.title} · {f.done} of 4 steps · private to you</>}
      how={<>Four steps, in any order. The ring always fills clockwise from the top, so the same
        percentage always looks the same. Fully Fluent arrives the moment someone recognizes you
        for this {ctx.term.one}, or you share a story about it, whatever the ring says.</>}>
      <div className="steprows">
        {FLUENCY_STEPS.map((s) => (
          <div key={s.key} className="steprow">
            <Tick on={f.steps[s.key]} /><span>{s.label(ctx.term)}</span><span className="st">{s.section}</span>
          </div>
        ))}
        <div className="steprow top">
          <Tick on={f.full} gold />
          <span>
            <b>Fully Fluent.</b> A gold star for this {ctx.term.one}, or a story you wrote and shared.
            {f.full && (
              <> <button className="linkbtn2" onClick={() => open(f.fullRecord)}>
                Earned by {f.fullBy === 'star' ? 'a gold star' : 'your story'}
              </button></>
            )}
          </span>
          <span className="st">Connection</span>
        </div>
      </div>
    </Shell>
  );
}

export function PracticeDetail({ ctx, behavior, p, scopeName, sessionId, onClose }) {
  const since = lastWeeks(p.of)[0].getTime();
  const rows = ctx.activity.iterations
    .filter((it) => (it.behavior_ids ?? []).includes(behavior.id))
    .filter((it) => it.system_category_id || (it.ritual_id && it.ritual_id !== sessionId))
    .filter((it) => new Date(it.held_at).getTime() >= since)
    .filter((it) => !ctx.myTeamId || it.team_id === ctx.myTeamId);
  return (
    <Shell onClose={onClose} term={ctx.term} art={<Medal size={52}><Metronome size={26} /></Medal>} kicker="Cadence"
      title={`Practiced ${p.count} of ${p.of}`}
      status={<><N n={behavior.number} /> {behavior.title} · {scopeName}</>}
      how={<>A ritual or a system recorded against this {ctx.term.one}, one mark per week across the
        organization's recent window of {p.of} weeks. The weekly practice session counts as
        discussion rather than practice.</>}>
      <div className="marksline">
        <WeekMarks marks={p.marks} /><span className="meta">oldest week first</span>
      </div>
      <RunList ctx={ctx} rows={rows} onClose={onClose} empty="Nothing recorded in the window yet." />
    </Shell>
  );
}

export function ConnectionDetail({ ctx, behavior, scopeName, recentDays, onClose }) {
  const since = Date.now() - recentDays * 86400000;
  const recs = ctx.activity.recognitions.filter((r) => r.behavior_id === behavior.id && new Date(r.created_at).getTime() >= since);
  const stories = ctx.activity.stories.filter((s) => s.behavior_id === behavior.id && new Date(s.created_at).getTime() >= since);
  const open = (kind, id) => { onClose(); ctx.openRecord(kind, id); };
  return (
    <Shell onClose={onClose} term={ctx.term} art={<Medal size={52}><Nodes size={26} /></Medal>} kicker="Connection"
      title="Connection Trophy"
      status={<><N n={behavior.number} /> {behavior.title} · {scopeName}</>}
      how={<>Someone was recognized, or a story was shared, against this {ctx.term.one} in the last
        {' '}{recentDays} days. It fades when nothing recent remains.</>}>
      <div className="runlist">
        {recs.map((r) => (
          <button key={r.id} className="runrow" onClick={() => open('recognition', r.id)}>
            <Avatar person={findPerson(ctx.people, { id: r.recipient_user_id, name: r.recipient })} name={r.recipient} size={22} />
            <span><b>{r.title || r.recipient}</b><small>{r.author_name} recognized {r.recipient}</small></span>
            <span className="w">{new Date(r.created_at).toLocaleDateString()}</span>
          </button>
        ))}
        {stories.map((s) => (
          <button key={s.id} className="runrow" onClick={() => open('story', s.id)}>
            <Avatar person={findPerson(ctx.people, { id: s.author_id, name: s.author_name })} name={s.author_name} size={22} />
            <span><b>Story</b><small>{s.author_name}</small></span>
            <span className="w">{new Date(s.created_at).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

/** Ritual and system runs, each opening its own record. */
export function RunList({ ctx, rows, onClose, empty }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  const team = (id) => ctx.teams.find((t) => t.id === id)?.name;
  return (
    <div className="runlist">
      {rows.map((it) => (
        <button key={it.id} className="runrow" onClick={() => { onClose?.(); ctx.openRecord('iteration', it.id); }}>
          <Avatar person={findPerson(ctx.people, { id: it.recorded_by, name: it.recorded_by_name })}
            name={it.recorded_by_name} size={22} />
          <span>
            <b>{it.ritual?.name ?? it.system?.name ?? 'Run'}</b>
            <small>
              {it.system ? 'System' : 'Ritual'}
              {(it.behaviors ?? []).map((b) => <React.Fragment key={b.id}> · <N n={b.number} /> {b.title}</React.Fragment>)}
              {team(it.team_id) ? ` · ${team(it.team_id)}` : ''} · {it.recorded_by_name}
            </small>
          </span>
          <span className="w">{new Date(it.held_at).toLocaleDateString()}</span>
        </button>
      ))}
    </div>
  );
}

export { fluencyName, weekKey };
