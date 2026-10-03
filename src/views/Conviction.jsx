import React, { useEffect, useState } from 'react';
import {
  getPulse, getCoverage, listMeasures, listMeasureEntries, recordMeasureEntry,
  listIterations, listPulseRounds
} from '../lib/api.js';
import { pad, N, NumList, PulseBar, CategoryBadge, Tag, BehaviorTag, Modal, Avatar, findPerson, useToast } from '../components/ui.jsx';
import { inCategory } from '../lib/categories.js';
import { RecordIteration } from './Cadence.jsx';

export default function Conviction({ ctx }) {
  const [tab, setTab] = useState('measures');
  // Pulse rounds, newest first, and the one the score tabs show. The open
  // round when nothing is picked.
  const [rounds, setRounds] = useState([]);
  const [roundNo, setRoundNo] = useState(null);
  useEffect(() => {
    listPulseRounds(ctx.org.id).then(setRounds).catch(() => setRounds([]));
  }, [ctx.org.id]);
  const round = rounds.find((r) => r.round === roundNo) ?? rounds[0] ?? null;
  const pick = { rounds, round, onPick: setRoundNo };

  return (
    <>
      <div className="dateline">Does it hold when it costs something?</div>
      <h1 className="pagetitle">Conviction</h1>
      <p className="lede">What the {ctx.term.many} are supposed to move, what people report, and whether the systems and rituals are actually running.</p>
      <div className="tabs">
        <button className="tab" aria-pressed={tab === 'measures'} onClick={() => setTab('measures')}>Measures</button>
        <button className="tab" aria-pressed={tab === 'summary'} onClick={() => setTab('summary')}>Summary ratings</button>
        <button className="tab" aria-pressed={tab === 'detail'} onClick={() => setTab('detail')}>Detail scores</button>
        <button className="tab" aria-pressed={tab === 'rounds'} onClick={() => setTab('rounds')}>Pulse rounds</button>
        <button className="tab" aria-pressed={tab === 'rhythm'} onClick={() => setTab('rhythm')}>Recent Iterations</button>
        <button className="tab" aria-pressed={tab === 'coverage'} onClick={() => setTab('coverage')}>Coverage</button>
      </div>
      {tab === 'measures' && <Measures ctx={ctx} />}
      {tab === 'summary' && <Summary ctx={ctx} {...pick} />}
      {tab === 'detail' && <DetailScores ctx={ctx} {...pick} />}
      {tab === 'rounds' && <PulseRounds ctx={ctx} rounds={rounds}
        onOpen={(n) => { setRoundNo(n); setTab('detail'); }} />}
      {tab === 'rhythm' && <RhythmIterations ctx={ctx} />}
      {tab === 'coverage' && <Coverage ctx={ctx} />}
    </>
  );
}

/* ------------------------------------------------------------- pulse rounds */

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const roundLabel = (r) => (r.is_open ? `Round ${r.round}, open now` : `Round ${r.round}, closed ${day(r.closed_at)}`);

/** Which round the scores below are for. */
function RoundPicker({ rounds, round, onPick }) {
  if (!round) return null;
  return (
    <div className="btnrow" style={{ marginBottom: 12 }}>
      <label className="fl" htmlFor="roundPick" style={{ margin: 0 }}>Showing</label>
      <select id="roundPick" className="field" style={{ width: 'auto' }} value={round.round}
        onChange={(e) => onPick(Number(e.target.value))}>
        {rounds.map((r) => <option key={r.round} value={r.round}>{roundLabel(r)}</option>)}
      </select>
    </div>
  );
}

/** How a round ended, in a few words. */
function howClosed(r) {
  if (r.is_open) return 'Open';
  if (r.reason === 'manual') return `Closed by ${r.closed_by_name ?? 'an admin'}`;
  return r.close_pct ? `Reached ${r.close_pct}%` : 'Reached the target';
}

/** Participation: people who rated everything, of the active members then. */
const participation = (r) => (r.finished != null && r.members
  ? `${r.finished} of ${r.members} (${Math.round((100 * r.finished) / r.members)}%)` : '—');

/** Every round, open and closed, with what came in. */
function PulseRounds({ ctx, rounds, onOpen }) {
  if (!rounds.length) return <section><div className="empty">No pulse rounds yet.</div></section>;
  return (
    <section>
      <div className="sectionhead">
        <h2>Pulse rounds</h2>
        <span className="note">A round is dated when it closes. Open one to see its scores.</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Round</th><th>Closed</th><th>How</th>
              <th>Rated every {ctx.term.one}</th><th>People who answered</th><th>Answers</th>
              <th>Average</th><th>Spread</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.round}>
                <td className="name">Round {r.round}</td>
                <td>{r.is_open ? <Tag>open now</Tag> : day(r.closed_at)}</td>
                <td className="meta">{howClosed(r)}</td>
                <td>{participation(r)}</td>
                <td>{r.raters}</td>
                <td>{r.responses}</td>
                <td>{r.avg_score != null ? Number(r.avg_score).toFixed(1) : '—'}</td>
                <td>{r.spread != null && r.responses ? Number(r.spread).toFixed(1) : '—'}</td>
                <td><button className="btn ghost small" onClick={() => onOpen(r.round)} disabled={!r.responses}>See scores</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- measures */
/* Definitions are an administrator's job, in Admin. Recording a value for a
   period is a separate, repeated act, which happens here.                   */

function Measures({ ctx }) {
  const { org, canLead } = ctx;
  const [measures, setMeasures] = useState([]);
  const [entries, setEntries] = useState([]);
  const [recording, setRecording] = useState(false);
  const toast = useToast();

  const load = () => Promise.all([listMeasures(org.id), listMeasureEntries(org.id)])
    .then(([m, e]) => { setMeasures(m); setEntries(e); })
    .catch(() => { setMeasures([]); setEntries([]); });
  useEffect(() => { load(); }, [org.id]);

  const periods = entries.slice(0, 4);

  return (
    <section>
      <div className="sectionhead">
        <h2>Measures these {ctx.term.many} should move</h2>
        <span className="note">
          {canLead && measures.length > 0 && (
            <button className="btn small" onClick={() => setRecording(true)}>Record a period</button>
          )}
        </span>
      </div>

      {!measures.length ? (
        <div className="empty">
          No measures defined yet. An administrator sets them up in Admin, then anyone leading
          can record a value for each period here.
        </div>
      ) : !periods.length ? (
        <div className="empty">Measures are defined, but no period has been recorded yet.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Measure</th>
                {periods.map((e) => <th key={e.id}>{e.period}</th>)}
              </tr>
            </thead>
            <tbody>
              {measures.map((m) => (
                <tr key={m.id}>
                  <td className="name">{m.name}<div className="s">{m.note}</div></td>
                  {periods.map((e) => <td key={e.id}>{e.values?.[m.id] ?? <span className="gap">&mdash;</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > 0 && (
        <p className="meta" style={{ marginTop: 12 }}>
          Most recent period recorded by {entries[0].recorded_by_name} on {new Date(entries[0].recorded_at).toLocaleDateString()}.
        </p>
      )}

      {recording && (
        <RecordPeriod measures={measures} onClose={() => setRecording(false)} toast={toast}
          onSave={async (period, values) => {
            await recordMeasureEntry(org.id, { period, values });
            toast('Period recorded.');
            setRecording(false);
            load();
          }} />
      )}
    </section>
  );
}

function RecordPeriod({ measures, onSave, onClose, toast }) {
  const [period, setPeriod] = useState('');
  const [values, setValues] = useState({});
  return (
    <Modal title="Record a period" onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => {
          if (!period.trim()) return toast('Name the period, for example Q4 2026.');
          onSave(period.trim(), values);
        }}>Save period</button>
      </>}>
      <label className="fl">Period</label>
      <input type="text" placeholder="Q4 2026, or October" value={period} onChange={(e) => setPeriod(e.target.value)} />
      {measures.map((m) => (
        <div key={m.id}>
          <label className="fl">{m.name}</label>
          <input type="text" value={values[m.id] ?? ''}
            onChange={(e) => setValues({ ...values, [m.id]: e.target.value })} />
        </div>
      ))}
    </Modal>
  );
}

/* --------------------------------------------------------- summary ratings */

function Summary({ ctx, rounds, round, onPick }) {
  const { org, behaviors, values, categories, term } = ctx;
  const [pulse, setPulse] = useState([]);

  useEffect(() => {
    if (!round) return;
    getPulse(org.id, round.round).then(setPulse).catch(() => setPulse([]));
  }, [org.id, round?.round]);

  const scored = pulse.filter((p) => p.responses > 0);
  const avg = scored.length
    ? (scored.reduce((s, p) => s + Number(p.avg_score), 0) / scored.length).toFixed(1) : null;
  const widest = [...scored].sort((a, b) => b.spread - a.spread)[0];

  const rollup = (ids) => {
    const rows = scored.filter((p) => ids.includes(p.behavior_id));
    if (!rows.length) return null;
    return (rows.reduce((s, r) => s + Number(r.avg_score), 0) / rows.length).toFixed(1);
  };

  // People who rated every behavior, against the active members: for the open
  // round, now; for a closed one, when it closed. Rounds closed before that
  // was recorded show how many people answered instead.
  const known = round && round.finished != null && round.members;
  const people = !round ? null : known
    ? { n: `${round.finished}/${round.members}`,
        l: round.is_open
          ? `People have rated every ${term.one} in round ${round.round}. It closes at ${round.close_pct}%.`
          : `People had rated every ${term.one} when round ${round.round} closed` }
    : { n: String(round.raters), l: `People answered in round ${round.round}` };

  return (
    <>
      <RoundPicker rounds={rounds} round={round} onPick={onPick} />
      <section>
        <div className="metrics">
          <div className="metric"><div className="n">{avg ?? '—'}</div><div className="l">Average, out of 5</div></div>
          <div className="metric">
            <div className="n">{widest ? Number(widest.spread).toFixed(1) : '—'}</div>
            <div className="l">{widest ? <>Widest split: <N n={widest.number} /> {widest.title}</> : 'No responses yet'}</div>
          </div>
          <div className="metric">
            <div className="n">{people?.n ?? '—'}</div>
            <div className="l">{people?.l ?? 'Pulse not started'}</div>
          </div>
        </div>
      </section>

      <section>
        <div className="sectionhead"><h2>By value</h2><span className="note">Which values are actually being lived</span></div>
        <div className="metrics">
          {values.map((v) => {
            const ids = behaviors.filter((b) => b.values.some((x) => x.id === v.id)).map((b) => b.id);
            const score = rollup(ids);
            return (
              <div key={v.id} className="metric">
                <div className="n">{score ?? '—'}</div>
                <div className="l">{v.name} ({ctx.term.count(ids.length)})</div>
                {score && <PulseBar score={Number(score)} spread={0} />}
              </div>
            );
          })}
        </div>
      </section>

{ctx.showCats && (
      <section>
        <div className="sectionhead">
          <h2>Categories</h2>
          <span className="note">Where the {ctx.term.many} cluster, and where they are thin</span>
        </div>
        <div className="tablewrap">
          <table className="ctable">
            <tbody>
              {categories.map((c) => {
                const ids = behaviors.filter((b) => inCategory(b, c.name)).map((b) => b.id);
                const score = rollup(ids);
                return (
                  <tr key={c.name}>
                    <td><CategoryBadge name={c.name} /></td>
                    <td>{c.question}</td>
                    <td className="meta">{ctx.term.Many} ({ids.length})</td>
                    <td className="meta">{score ? `${score} avg` : 'not scored'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------- detail scores */

function DetailScores({ ctx, rounds, round, onPick }) {
  const { org, openBehavior, term } = ctx;
  const [pulse, setPulse] = useState([]);
  useEffect(() => {
    if (!round) return;
    getPulse(org.id, round.round).then(setPulse).catch(() => setPulse([]));
  }, [org.id, round?.round]);

  const scored = pulse.filter((p) => p.responses > 0).sort((a, b) => a.avg_score - b.avg_score);
  const unscored = pulse.filter((p) => !p.responses);
  const perSignin = org.pulse_per_signin ?? 2;

  return (
    <section>
      <RoundPicker rounds={rounds} round={round} onPick={onPick} />
      <div className="sectionhead">
        <h2>{term.One} pulse</h2>
        <span className="note">The gold band is the spread of answers, not the average</span>
      </div>
      {scored.length ? scored.map((p) => (
        <div key={p.behavior_id} className="pulserow">
          <div className="pulsetop">
            <span className="nm btn2" onClick={() => openBehavior(p.behavior_id)}>
              <span className="bnum">{pad(p.number)}.</span> {p.title}
            </span>
            <span className="sc">{Number(p.avg_score).toFixed(1)} avg / {Number(p.spread).toFixed(1)} spread / {p.responses} response{p.responses === 1 ? '' : 's'}</span>
          </div>
          <PulseBar score={Number(p.avg_score)} spread={Number(p.spread)} />
        </div>
      )) : (
        <div className="empty">
          {round && !round.is_open
            ? `No responses in round ${round.round}.`
            : `No responses yet. Each person is asked about ${term.count(perSignin)} when they sign in, so the
               first numbers arrive as people come through.`}
        </div>
      )}

      {unscored.length > 0 && scored.length > 0 && (
        <div className="notice">
          {round && !round.is_open ? `Not scored in round ${round.round}` : 'Not yet scored this round'}: <NumList items={unscored} />.
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------- rhythm iterations */

function RhythmIterations({ ctx }) {
  const { org, rituals, behaviors, systems, openRecord } = ctx;
  const [runs, setRuns] = useState([]);
  // The ritual or system whose name was clicked, to record a run of it.
  const [recording, setRecording] = useState(null);
  const toast = useToast();
  const days = org.recent_days ?? 45;

  const loadRuns = () => listIterations(org.id).then(setRuns).catch(() => setRuns([]));
  useEffect(() => { loadRuns(); }, [org.id]);

  const cutoff = Date.now() - days * 86400000;
  // Rituals and systems side by side: a system run is recorded the same way.
  const rowFor = (item, kind, match) => {
    const mine = runs.filter(match);
    const recent = mine.filter((x) => new Date(x.held_at).getTime() >= cutoff);
    return { ritual: item, kind, total: mine.length, recent: recent.length, last: mine[0] ?? null };
  };
  const summary = [
    ...rituals.map((r) => rowFor(r, 'Ritual', (x) => x.ritual_id === r.id)),
    ...systems.map((sy) => rowFor({ ...sy, cadence: 'System' }, 'System', (x) => x.system_category_id === sy.id))
  ].sort((a, b) => (b.last ? new Date(b.last.held_at) : 0) - (a.last ? new Date(a.last.held_at) : 0));

  return (
    <>
      <section>
        <div className="sectionhead">
          <h2>Rituals and systems, by recency</h2>
          <span className="note">Recent means the last {days} days</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Ritual or system</th><th>Cadence</th><th>Last run</th><th>Recent</th><th>All time</th></tr></thead>
            <tbody>
              {summary.map(({ ritual, kind, total, recent, last }) => (
                <tr key={`${kind}-${ritual.id}`} className={last ? '' : 'flagged'}>
                  <td className="name">
                    <button className="linkbtn" title={`Record a run of ${ritual.name}`}
                      onClick={() => setRecording({ kind, item: ritual })}>{ritual.name}</button>
                  </td>
                  <td className="meta">{ritual.cadence}</td>
                  <td>{last ? new Date(last.held_at).toLocaleDateString() : <span className="gap">never</span>}</td>
                  <td>{recent || <span className="gap">0</span>}</td>
                  <td>{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="sectionhead"><h2>Every iteration</h2><span className="note">Recorded ({runs.length})</span></div>
        <div className="rowlist">
          {runs.slice(0, 40).map((r) => (
            <div key={r.id} className="row">
              <div>
                <div className="t">
                  {r.ritual?.name ?? r.system?.name ?? 'Run'}{r.system ? ' (system)' : ''}
                  {r.parent_id ? ` (in ${r.parentSystem?.name ?? 'a system session'})` : ''}
                </div>
                <div className="s who2">
                  <Avatar person={findPerson(ctx.people, { id: r.recorded_by, name: r.recorded_by_name })} name={r.recorded_by_name} size={18} />
                  {new Date(r.held_at).toLocaleDateString()} / {r.recorded_by_name}
                  {ctx.teams.find((t) => t.id === r.team_id) ? ` / ${ctx.teams.find((t) => t.id === r.team_id).name}` : ''}
                </div>
                {r.behaviors?.length > 0 && (
                  <div className="tagrow">
                    {r.behaviors.map((b) => <BehaviorTag key={b.id} behavior={b} />)}
                  </div>
                )}
              </div>
              <button className="btn ghost small" onClick={() => openRecord('iteration', r.id)}>Open</button>
            </div>
          ))}
          {!runs.length && <div className="row"><div className="s">Nothing recorded yet.</div></div>}
        </div>
      </section>

      {recording && (
        <RecordIteration ctx={ctx} toast={toast}
          ritual={recording.kind === 'Ritual' ? recording.item : undefined}
          system={recording.kind === 'System' ? systems.find((s) => s.id === recording.item.id) : undefined}
          onClose={() => setRecording(null)}
          onDone={() => { setRecording(null); loadRuns(); ctx.refreshActivity(); }} />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- coverage */

function Coverage({ ctx }) {
  const { org, behaviors, systems, rituals, openBehavior, openRecord, categories, showCats } = ctx;
  const [coverage, setCoverage] = useState([]);
  const [runs, setRuns] = useState([]);
  const [view, setView] = useState('system');

  useEffect(() => {
    getCoverage(org.id).then(setCoverage).catch(() => setCoverage([]));
    listIterations(org.id).then(setRuns).catch(() => setRuns([]));
  }, [org.id]);

  const gaps = coverage.filter((c) => c.is_gap);
  const lastRunFor = (behaviorId, ritualId) => {
    const hit = runs.find((r) => r.ritual_id === ritualId && (r.behavior_ids ?? []).includes(behaviorId));
    return hit ? new Date(hit.held_at).toLocaleDateString() : null;
  };

  return (
    <>
      <div className="tabs sub">
        <button className="tab" aria-pressed={view === 'system'} onClick={() => setView('system')}>By system</button>
        <button className="tab" aria-pressed={view === 'rhythm'} onClick={() => setView('rhythm')}>By rhythm</button>
        {showCats && (
          <button className="tab" aria-pressed={view === 'category'} onClick={() => setView('category')}>By category</button>
        )}
      </div>

      {view === 'category' && showCats ? (
        <CategoryCoverage ctx={ctx} categories={categories} behaviors={behaviors} openBehavior={openBehavior} />
      ) : (<>
      {gaps.length > 0 && (
        <div className="notice flagnotice">
          {ctx.term.count(gaps.length)} reinforced in fewer than two systems: <NumList items={gaps} />.
        </div>
      )}

      <section>
        {view === 'system' ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>#</th><th>{ctx.term.One}</th>{systems.map((s) => <th key={s.id}>{s.name}</th>)}<th>Status</th></tr>
              </thead>
              <tbody>
                {behaviors.map((b) => {
                  const gap = b.placements.length < 2;
                  return (
                    <tr key={b.id} className={gap ? 'flagged' : ''}>
                      <td className="name"><span className="bnum">{pad(b.number)}</span></td>
                      <td className="name btn2" onClick={() => openBehavior(b.id)}>{b.title}</td>
                      {systems.map((s) => {
                        const p = b.placements.find((x) => x.systemId === s.id);
                        return (
                          <td key={s.id}>
                            {p ? (
                              <button className="linkbtn" title={`${s.name} for ${b.title}: open the details`}
                                onClick={() => openRecord('placement', p.id)}>
                                <span className="mark">{p.cadence}</span><span className="s" style={{ display: 'block' }}>{p.owner}</span>
                              </button>
                            ) : <span className="gap">&mdash;</span>}
                          </td>
                        );
                      })}
                      <td>{gap ? <Tag type="warn">Gap</Tag> : <Tag type="system">Held</Tag>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>#</th><th>{ctx.term.One}</th>{rituals.map((r) => (
                  <th key={r.id}>
                    <button className="linkbtn" title={`Open ${r.name}`} onClick={() => openRecord('ritual', r.id)}>{r.name}</button>
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {behaviors.map((b) => (
                  <tr key={b.id} className={b.rituals.length ? '' : 'flagged'}>
                    <td className="name"><span className="bnum">{pad(b.number)}</span></td>
                    <td className="name btn2" onClick={() => openBehavior(b.id)}>{b.title}</td>
                    {rituals.map((r) => {
                      const applied = r.applies_to_all || b.rituals.some((x) => x.id === r.id);
                      const last = applied ? lastRunFor(b.id, r.id) : null;
                      return (
                        <td key={r.id}>
                          {applied ? (
                            <button className="linkbtn" title={`${r.name} for ${b.title}: open the details`}
                              onClick={() => openRecord('ritual', r.id)}>
                              {last ? <span className="mark">{last}</span> : <Tag type="warn">not run</Tag>}
                            </button>
                          ) : <span className="gap">&mdash;</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>)}
    </>
  );
}

/**
 * Which of the 5C categories each behavior sits in, and how many land in
 * each. A category with none, or only one, is where the culture is thin.
 */
function CategoryCoverage({ ctx, categories, behaviors, openBehavior }) {
  // A behavior counts in its own category and in each of its values' categories.
  const counts = Object.fromEntries(categories.map((c) => [c.name, behaviors.filter((b) => inCategory(b, c.name)).length]));
  const thin = categories.filter((c) => counts[c.name] < 2);
  const none = behaviors.filter((b) => !categories.some((c) => inCategory(b, c.name)));
  return (
    <>
      {thin.length > 0 && (
        <div className="notice flagnotice">
          Thin coverage: {thin.map((c) => `${c.name} (${counts[c.name]})`).join(', ')}. A category with
          fewer than two {ctx.term.many} leaves that side of the culture to chance.
        </div>
      )}
      <section>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>#</th><th>{ctx.term.One}</th>{categories.map((c) => <th key={c.name} className="cbox">{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {behaviors.map((b) => (
                <tr key={b.id} className={categories.some((c) => inCategory(b, c.name)) ? '' : 'flagged'}>
                  <td className="name"><span className="bnum">{pad(b.number)}</span></td>
                  <td className="name btn2" onClick={() => openBehavior(b.id)}>{b.title}</td>
                  {categories.map((c) => (
                    <td key={c.name} className="ccell">
                      {inCategory(b, c.name) ? <Tag type="category">{c.name}</Tag> : <span className="gap">&mdash;</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="ctotal">
                <td /><td>{ctx.term.Many} per category</td>
                {categories.map((c) => (
                  <td key={c.name} className="ccell">
                    {counts[c.name] < 2 ? <Tag type="warn">{counts[c.name]}</Tag> : counts[c.name]}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {none.length > 0 && (
          <p className="meta">{ctx.term.count(none.length)} without a category. Set one on the {ctx.term.one}'s edit form.</p>
        )}
      </section>
    </>
  );
}
