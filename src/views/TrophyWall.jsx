import React, { useMemo, useState } from 'react';
import { grantAward } from '../lib/api.js';
import { Modal, N, Avatar, Who, findPerson, useToast } from '../components/ui.jsx';
import {
  GoldStar, Crest, Seal, CairnDone, Medal, Lens, Nodes, Converge, FluencyBadge
} from '../components/badges.jsx';
import { useBehaviorBadges, FluencyDetail } from '../components/badgeDetails.jsx';
import { PostForm, ShareRecord } from './Connection.jsx';
import { Attachments } from './Details.jsx';
import {
  sessionRitualId, recentWeeks, botwStreak, fullSet, cairnFor, gapClosed, weeklyEvents
} from '../lib/gamify.js';

const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * What has been earned, for you, your team and the organization. Streaks and
 * practice counts live on the home page; this wall holds trophies only.
 */
export default function TrophyWall({ ctx }) {
  const { org, teams, myTeamId, canLead } = ctx;
  const team = teams.find((t) => t.id === myTeamId);
  const [scope, setScope] = useState('me');
  const [modal, setModal] = useState(null);
  const toast = useToast();

  return (
    <>
      <div className="dateline">Recognition, awards and badges</div>
      <div className="detailhead">
        <h1 className="pagetitle">Trophy Wall</h1>
        <div className="btnrow" style={{ marginTop: 0 }}>
          <button className="btn small" onClick={() => setModal({ kind: 'recognize' })}>Recognize someone</button>
          {canLead && (
            <button className="btn small" onClick={() => setModal({ kind: 'give' })}>Give a Value award</button>
          )}
        </div>
      </div>
      <p className="lede">What has been earned. Streaks and practice counts live on the home page.</p>

      <div className="tabs">
        <button className="tab" aria-pressed={scope === 'me'} onClick={() => setScope('me')}>Me</button>
        {team && <button className="tab" aria-pressed={scope === 'team'} onClick={() => setScope('team')}>{team.name}</button>}
        <button className="tab" aria-pressed={scope === 'org'} onClick={() => setScope('org')}>{org.name}</button>
      </div>

      {scope === 'me' ? <MyWall ctx={ctx} setModal={setModal} />
        : <GroupWall ctx={ctx} team={scope === 'team' ? team : null} setModal={setModal} />}

      {modal?.kind === 'give' && <GiveAward ctx={ctx} onClose={() => setModal(null)} />}
      {modal?.kind === 'recognize' && (
        <PostForm ctx={ctx} kind="recognition" onClose={() => setModal(null)} toast={toast}
          onDone={() => { setModal(null); ctx.reload(); }} />
      )}
      {modal?.kind === 'grant' && <GrantDetail ctx={ctx} grant={modal.grant} onClose={() => setModal(null)} />}
      {modal?.kind === 'given' && <GivenList ctx={ctx} onClose={() => setModal(null)} />}
      {modal?.kind === 'fluency' && (
        <FluencyDetail ctx={ctx} behavior={modal.b} f={modal.f} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'info' && (
        <Modal title={modal.title} onClose={() => setModal(null)}
          footer={<button className="btn ghost" onClick={() => setModal(null)}>Close</button>}>
          <div className="badgehead">
            <span className="badgeart">{modal.art}</span>
            <span><span className="kicker2">{modal.kicker}</span><span className="badgestatus">{modal.status}</span></span>
          </div>
          <h4 className="fl">How it is earned</h4>
          <p className="badgehow">{modal.how}</p>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function Section({ title, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="wallsection">
      <div className="sectionhead"><h2 className="small">{title}</h2></div>
      <div className="tgrid">{items}</div>
    </section>
  );
}

function Trophy({ art, kicker, title, meta, onClick, files }) {
  const card = (
    <button className="tro" onClick={onClick}>
      <span className="art">{art}</span>
      <span>
        <span className="kick">{kicker}</span>
        <span className="ttl">{title}</span>
        <span className="tmeta">{meta}</span>
      </span>
    </button>
  );
  if (!files?.length) return card;
  // Files sit under the card, outside the button, so a video can play and a
  // picture can open without opening the award.
  return <div className="trowrap">{card}<div className="trofiles"><Attachments files={files} compact /></div></div>;
}

const valueNames = (ctx, award) =>
  (award?.valueIds ?? []).map((id) => ctx.values.find((v) => v.id === id)?.name).filter(Boolean);

function CrestTrophy({ ctx, g, setModal }) {
  const names = valueNames(ctx, g.award);
  return (
    <Trophy key={g.id}
      art={<Crest height={50} pips={Math.max(1, names.length)} />}
      kicker={names.join(' · ') || 'Value award'}
      title={g.award?.name ?? 'Value award'}
      meta={<>Conferred on {g.recipient_name} by {g.granted_by_name} · {fmt(g.granted_at)}</>}
      files={g.attachments}
      onClick={() => setModal({ kind: 'grant', grant: g })} />
  );
}

/* ---------------------------------------------------------------------- me */

function MyWall({ ctx, setModal }) {
  const { userId, grants, activity, behaviors, openRecord } = ctx;
  const badges = useBehaviorBadges(ctx);
  const byId = Object.fromEntries(behaviors.map((b) => [b.id, b]));

  const myGrants = grants.filter((g) => (g.recipients ?? []).includes(userId) || g.recipient_user_id === userId);
  const stars = activity.recognitions.filter((r) => r.recipient_user_id && r.recipient_user_id === userId);
  const given = activity.recognitions.filter((r) => r.author_id === userId);
  const full = behaviors.filter((b) => badges.fluency[b.id]?.full);
  const nothing = !myGrants.length && !stars.length && !given.length && !full.length;

  return (
    <>
      {nothing && (
        <div className="empty" style={{ marginTop: 20 }}>
          Nothing here yet. Recognition someone gives you lands here as a gold star.
        </div>
      )}
      <Section title="Value awards">
        {myGrants.map((g) => <CrestTrophy key={g.id} ctx={ctx} g={g} setModal={setModal} />)}
      </Section>

      <Section title="Gold stars">
        {stars.map((r) => {
          const b = byId[r.behavior_id];
          return (
            <Trophy key={r.id} art={<GoldStar size={40} />}
              kicker={b ? <><N n={b.number} /> {b.title}</> : 'Recognition'}
              title={r.title || 'Recognized'}
              meta={<span className="who2">
                <Avatar person={findPerson(ctx.people, { id: r.author_id, name: r.author_name })} name={r.author_name} size={16} />
                from {r.author_name} · {fmt(r.created_at)} · View detail
              </span>}
              onClick={() => openRecord('recognition', r.id)} />
          );
        })}
      </Section>

      <Section title="Recognizer">
        {given.length > 0 && (
          <Trophy art={<Medal size={44}><Nodes size={22} /></Medal>} kicker="Connection"
            title={`${given.length} recognition${given.length === 1 ? '' : 's'} given`}
            meta="Recognition you gave to other people · View the list"
            onClick={() => setModal({ kind: 'given' })} />
        )}
      </Section>

      <Section title="Fully Fluent">
        {full.map((b) => {
          const f = badges.fluency[b.id];
          return (
            <Trophy key={b.id} art={<FluencyBadge f={f} size={44} />}
              kicker={<><N n={b.number} /> {b.title}</>} title="Fully Fluent"
              meta={f.fullBy === 'star' ? 'Earned by a gold star' : 'Earned by a shared story'}
              onClick={() => setModal({ kind: 'fluency', b, f })} />
          );
        })}
      </Section>
    </>
  );
}

/* --------------------------------------------------------- team and org */

function GroupWall({ ctx, team, setModal }) {
  const { org, rituals, activity, behaviors, grants, people } = ctx;
  const scope = team ? { kind: 'team', teamId: team.id } : { kind: 'org' };
  const name = team ? team.name : org.name;

  const d = useMemo(() => {
    const sessionId = sessionRitualId(rituals);
    const rw = recentWeeks(org);
    const cairn = activity.pulseStatus ? cairnFor(activity.pulseStatus) : null;
    return {
      rw,
      streak: botwStreak(activity.iterations, sessionId, scope),
      set: fullSet(behaviors, activity.iterations, sessionId, scope),
      cairn,
      gap: cairn ? gapClosed(activity.pulseSpread ?? [], activity.pulseStatus.round) : { earned: false },
      events: weeklyEvents(activity.iterations, activity.recognitions, activity.stories, people, scope, Math.max(rw, 4))
    };
  }, [org, rituals, activity, behaviors, people, scope.kind, scope.teamId]);

  const myGrants = team ? grants.filter((g) => g.team_id === team.id) : grants;
  const total = d.events.cadence.reduce((a, b) => a + b, 0) + d.events.connection.reduce((a, b) => a + b, 0);

  return (
    <>
      <Section title="Value awards">
        {myGrants.map((g) => <CrestTrophy key={g.id} ctx={ctx} g={g} setModal={setModal} />)}
      </Section>

      <Section title="Clarity">
        {d.set.earned && (
          <Trophy art={<Medal size={48} solid><Lens size={24} /></Medal>} kicker={`All ${ctx.term.Many}`}
            title="The Full Set"
            meta={`All ${d.set.total} ${ctx.term.many} discussed and practiced · earned ${fmt(d.set.earnedAt)}`}
            onClick={() => setModal({ kind: 'info', title: 'The Full Set', kicker: `Clarity · all ${ctx.term.many}`,
              art: <Medal size={56} solid><Lens size={28} /></Medal>,
              status: `${name} · earned ${fmt(d.set.earnedAt)}`,
              how: `Every active ${ctx.term.one} has been discussed as ${ctx.term.One} of the Week and practiced through a ritual or a system at least once. It is earned on the day the last one was completed.` })} />
        )}
      </Section>

      <Section title="Cadence">
        {d.streak.seal.tier > 0 && (
          <Trophy art={<Seal size={50} months={d.streak.seal.months} tier={d.streak.seal.tier} />}
            kicker={`${ctx.term.One} of the Week`} title={d.streak.seal.name}
            meta={`${d.streak.weeks} consecutive weeks for ${name}`}
            onClick={() => setModal({ kind: 'info', title: d.streak.seal.name, kicker: 'Cadence Seal',
              art: <Seal size={64} months={d.streak.seal.months} tier={d.streak.seal.tier} />,
              status: `${d.streak.weeks} consecutive weeks for ${name} · ${d.streak.seal.months} of 12 months`,
              how: `An unbroken run of weeks with a ${ctx.term.One} of the Week discussion recorded. Seals come at 4, 12, 26 and 52 weeks; each of the twelve notches is a month, so a full ring is a year. The week in progress never breaks a run, and a missed week starts it over.` })} />
        )}
      </Section>

      <Section title="Conviction">
        {d.cairn?.completed > 0 && (
          <Trophy art={<CairnDone size={44} rounds={d.cairn.completed} />} kicker="Survey cadence"
            title={d.cairn.completed === 1 ? 'First pulse round complete' : `${d.cairn.completed} pulse rounds complete`}
            meta={`${d.cairn.scored} of ${d.cairn.total} ${ctx.term.many} answered toward the next`}
            onClick={() => setModal({ kind: 'info', title: 'Survey cadence', kicker: 'Conviction',
              art: <CairnDone size={56} rounds={d.cairn.completed} />,
              status: `${d.cairn.completed} round${d.cairn.completed === 1 ? '' : 's'} complete · round ${d.cairn.round} under way`,
              how: `A pulse round is complete when every ${ctx.term.one} has been answered by a quarter of the organization. The cairn on the home page fills from the bottom as that happens; each finished round adds one to the number on the base stone.` })} />
        )}
        {!team && d.gap.earned && (
          <Trophy art={<Medal size={44} solid><Converge size={22} /></Medal>} kicker="Trust view"
            title="Gap Closed" meta={`Spread narrowed from ${d.gap.from.toFixed(1)} to ${d.gap.to.toFixed(1)} in round ${d.gap.round}`}
            onClick={() => setModal({ kind: 'info', title: 'Gap Closed', kicker: 'Conviction · trust view',
              art: <Medal size={56} solid><Converge size={28} /></Medal>,
              status: `Average spread ${d.gap.from.toFixed(1)} → ${d.gap.to.toFixed(1)}, round ${d.gap.round}`,
              how: `The distance between the highest and lowest pulse scores narrowed from one finished round to the next. Spread is the signal: a narrowing gap means people are experiencing the ${ctx.term.many} more alike.` })} />
        )}
      </Section>

      {!d.set.earned && d.streak.seal.tier === 0 && !(d.cairn?.completed > 0) && !myGrants.length && (
        <div className="empty" style={{ marginTop: 20 }}>No trophies for {name} yet. The first seal comes at four straight weeks.</div>
      )}

      <section className="wallsection">
        <div className="sectionhead">
          <h2 className="small">Cadence and connection events</h2>
          <span className="note">Last {d.events.labels.length} weeks</span>
        </div>
        <div className="panel">
          <div className="bigstat" style={{ marginTop: 0 }}>
            <span className="n">{total}</span><span className="cap">events recorded by {name}</span>
          </div>
          <EventsChart events={d.events} />
        </div>
      </section>
    </>
  );
}

/** Grouped bars, one pair per week, drawn to one scale with labelled gridlines. */
function EventsChart({ events }) {
  const W = 640, H = 190, L = 34, R = 10, T = 14, B = 30;
  const max = Math.max(1, ...events.cadence, ...events.connection);
  const step = max <= 6 ? 2 : max <= 15 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const pw = W - L - R, ph = H - T - B, gw = pw / events.labels.length, bw = Math.min(24, gw / 3.2);
  const y = (v) => T + ph - (v / top) * ph;
  const ticks = [];
  for (let g = 0; g <= top; g += step) ticks.push(g);
  return (
    <>
      <div className="chartwrap">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cadence and connection events per week">
          {ticks.map((g) => (
            <g key={g}>
              <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth="1" />
              <text x={L - 7} y={y(g) + 4} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="Archivo, sans-serif">{g}</text>
            </g>
          ))}
          {events.labels.map((lab, i) => {
            const cx = L + gw * i + gw / 2;
            return (
              <g key={lab}>
                <rect x={cx - bw - 2} y={y(events.cadence[i])} width={bw} height={Math.max(1, ph - (y(events.cadence[i]) - T))} rx="2" fill="var(--spruce)" />
                <rect x={cx + 2} y={y(events.connection[i])} width={bw} height={Math.max(1, ph - (y(events.connection[i]) - T))} rx="2" fill="var(--gold-bright)" />
                <text x={cx} y={H - 9} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="Archivo, sans-serif">{lab}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend">
        <span><b style={{ background: 'var(--spruce)' }} />Cadence: rituals and systems recorded</span>
        <span><b style={{ background: 'var(--gold-bright)' }} />Connection: recognition and stories</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ modals */

function GrantDetail({ ctx, grant, onClose }) {
  const [sharing, setSharing] = useState(false);
  const toast = useToast();
  const names = valueNames(ctx, grant.award);
  if (sharing) {
    return (
      <ShareRecord kind="award" id={grant.id} onClose={onClose} toast={toast}
        summary={<div className="badgehead">
          <span className="badgeart"><Crest height={44} pips={Math.max(1, names.length)} /></span>
          <span><span className="kicker2">{names.join(' · ')}</span>
            <span className="badgestatus">{grant.award?.name} for {grant.recipient_name}</span></span>
        </div>} />
    );
  }
  const recipient = grant.recipient_user_id ? findPerson(ctx.people, { id: grant.recipient_user_id }) : null;
  const giver = findPerson(ctx.people, { id: grant.granted_by, name: grant.granted_by_name });
  return (
    <Modal title={grant.award?.name ?? 'Value award'} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={() => setSharing(true)}>Share by email</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </>}>
      <div className="badgehead">
        <span className="badgeart"><Crest height={64} pips={Math.max(1, names.length)} /></span>
        <span>
          <span className="kicker2">{names.join(' · ')}</span>
          <span className="badgestatus">
            {grant.team_id ? `Conferred on the ${grant.recipient_name} team` : <Who person={recipient} name={grant.recipient_name} size={22} />}
          </span>
        </span>
      </div>
      <p className="recordbody">{grant.citation}</p>
      <Attachments files={grant.attachments ?? []} />
      <p className="byline who2">
        <Avatar person={giver} name={grant.granted_by_name} size={20} />
        Conferred by {grant.granted_by_name} · {fmt(grant.granted_at)}
      </p>
      {grant.award?.description && <p className="meta">{grant.award.description}</p>}
    </Modal>
  );
}

function GivenList({ ctx, onClose }) {
  const { userId, activity, behaviors } = ctx;
  const byId = Object.fromEntries(behaviors.map((b) => [b.id, b]));
  const given = activity.recognitions.filter((r) => r.author_id === userId);
  return (
    <Modal title="Recognition you gave" onClose={onClose} wide
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      <div className="runlist">
        {given.map((r) => {
          const b = byId[r.behavior_id];
          return (
            <button key={r.id} className="runrow" onClick={() => { onClose(); ctx.openRecord('recognition', r.id); }}>
              <Avatar person={findPerson(ctx.people, { id: r.recipient_user_id, name: r.recipient })} name={r.recipient} size={22} />
              <span>
                <b>{r.title || r.recipient}</b>
                <small>{r.recipient}{b ? <> · <N n={b.number} /> {b.title}</> : ''}</small>
              </span>
              <span className="w">{fmt(r.created_at)}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * A leader confers a named Value award on a person or a team. The award's
 * own rules decide which, and how many a leader may give per period; the
 * database enforces both.
 */
function GiveAward({ ctx, onClose }) {
  const { org, awardTypes, people, teams, userId, reload } = ctx;
  const active = awardTypes.filter((a) => a.active !== false);
  const [f, setF] = useState({ awardId: active[0]?.id ?? '', to: 'member', recipientId: '', teamId: '', citation: '', files: [] });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const award = active.find((a) => a.id === f.awardId);
  const kinds = !award ? [] : award.grantable_to === 'both' ? ['member', 'team'] : [award.grantable_to];
  const to = kinds.includes(f.to) ? f.to : kinds[0];
  const members = people.filter((p) => p.in_org !== false && p.user_id !== userId)
    .slice().sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''));
  const names = valueNames(ctx, award);

  async function save() {
    if (!award) return toast('Choose an award.');
    if (to === 'member' && !f.recipientId) return toast('Choose who receives it.');
    if (to === 'team' && !f.teamId) return toast('Choose the team.');
    if (!f.citation.trim()) return toast('Write the citation: what they did.');
    setBusy(true);
    try {
      const recipientName = to === 'team'
        ? teams.find((t) => t.id === f.teamId)?.name
        : members.find((p) => p.user_id === f.recipientId)?.display_name;
      await grantAward(org.id, {
        awardTypeId: award.id, citation: f.citation, recipientName, files: f.files,
        recipientUserId: to === 'member' ? f.recipientId : null, teamId: to === 'team' ? f.teamId : null
      });
      toast(`${award.name} conferred on ${recipientName}.`);
      await reload();
      onClose();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  if (!active.length) {
    return (
      <Modal title="Give a Value award" onClose={onClose}
        footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
        <div className="empty">No Value awards are set up yet. An admin creates them in Admin, under Value awards.</div>
      </Modal>
    );
  }

  return (
    <Modal title="Give a Value award" onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Confer the award'}</button>
      </>}>
      <label className="fl">Award</label>
      <select className="field" value={f.awardId} onChange={(e) => setF({ ...f, awardId: e.target.value })}>
        {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {award && (
        <div className="badgehead" style={{ marginTop: 10 }}>
          <span className="badgeart"><Crest height={46} pips={Math.max(1, names.length)} /></span>
          <span>
            <span className="kicker2">{names.join(' · ')}</span>
            <span className="meta">
              {award.description}
              {award.grant_cap ? ` Each leader can give ${award.grant_cap} per ${award.cap_period}.` : ''}
            </span>
          </span>
        </div>
      )}

      {kinds.length > 1 && (
        <div className="tagrow" style={{ marginTop: 12 }}>
          <button className="pill" aria-pressed={to === 'member'} onClick={() => setF({ ...f, to: 'member' })}>To a person</button>
          <button className="pill" aria-pressed={to === 'team'} onClick={() => setF({ ...f, to: 'team' })}>To a team</button>
        </div>
      )}
      {to === 'member' ? (
        <>
          <label className="fl">Who receives it</label>
          <select className="field" value={f.recipientId} onChange={(e) => setF({ ...f, recipientId: e.target.value })}>
            <option value="">Choose a person</option>
            {members.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
          </select>
        </>
      ) : (
        <>
          <label className="fl">Which team</label>
          <select className="field" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
            <option value="">Choose a team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="meta" style={{ marginTop: 6 }}>Everyone on the team today gets it on their own wall, and keeps it if they move teams.</p>
        </>
      )}
      <label className="fl">Citation: what they did</label>
      <textarea rows={4} value={f.citation} onChange={(e) => setF({ ...f, citation: e.target.value })}
        placeholder="A season of doing the right thing when nobody was checking" />
      <label className="fl" htmlFor="awardFiles">Photo, video or file, optional</label>
      <input id="awardFiles" type="file" multiple accept="image/*,video/*,.pdf,.docx"
        onChange={(e) => setF({ ...f, files: Array.from(e.target.files) })} />
      {f.files.length > 0 && (
        <div className="tagrow" style={{ marginTop: 8 }}>
          {f.files.map((x) => <span key={x.name} className="tag">{x.name}</span>)}
        </div>
      )}
    </Modal>
  );
}
