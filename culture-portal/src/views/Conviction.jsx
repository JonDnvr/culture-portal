import React, { useEffect, useState } from 'react';
import {
  getPulse, getCoverage, listMeasures, listMeasureEntries, recordMeasureEntry,
  listIterations, getPulseStatus
} from '../lib/api.js';
import { pad, PulseBar, CategoryBadge, Tag, BehaviorTag, Modal, useToast } from '../components/ui.jsx';

export default function Conviction({ ctx }) {
  const [tab, setTab] = useState('measures');
  return (
    <>
      <div className="dateline">Does it hold when it costs something?</div>
      <h1 className="pagetitle">Conviction</h1>
      <p className="lede">What the behaviors are supposed to move, what people report, and whether the systems and rituals are actually running.</p>
      <div className="tabs">
        <button className="tab" aria-pressed={tab === 'measures'} onClick={() => setTab('measures')}>Measures</button>
        <button className="tab" aria-pressed={tab === 'summary'} onClick={() => setTab('summary')}>Summary ratings</button>
        <button className="tab" aria-pressed={tab === 'detail'} onClick={() => setTab('detail')}>Detail scores</button>
        <button className="tab" aria-pressed={tab === 'rhythm'} onClick={() => setTab('rhythm')}>Rhythm iterations</button>
        <button className="tab" aria-pressed={tab === 'coverage'} onClick={() => setTab('coverage')}>Coverage</button>
      </div>
      {tab === 'measures' && <Measures ctx={ctx} />}
      {tab === 'summary' && <Summary ctx={ctx} />}
      {tab === 'detail' && <DetailScores ctx={ctx} />}
      {tab === 'rhythm' && <RhythmIterations ctx={ctx} />}
      {tab === 'coverage' && <Coverage ctx={ctx} />}
    </>
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
        <h2>Measures these behaviors should move</h2>
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

function Summary({ ctx }) {
  const { org, behaviors, values, categories } = ctx;
  const [pulse, setPulse] = useState([]);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    getPulse(org.id).then(setPulse).catch(() => setPulse([]));
    getPulseStatus(org.id).then(setStatus).catch(() => setStatus(null));
  }, [org.id]);

  const scored = pulse.filter((p) => p.responses > 0);
  const avg = scored.length
    ? (scored.reduce((s, p) => s + Number(p.avg_score), 0) / scored.length).toFixed(1) : null;
  const widest = [...scored].sort((a, b) => b.spread - a.spread)[0];

  const rollup = (ids) => {
    const rows = scored.filter((p) => ids.includes(p.behavior_id));
    if (!rows.length) return null;
    return (rows.reduce((s, r) => s + Number(r.avg_score), 0) / rows.length).toFixed(1);
  };

  return (
    <>
      <section>
        <div className="metrics">
          <div className="metric"><div className="n">{avg ?? '—'}</div><div className="l">Average, out of 5</div></div>
          <div className="metric">
            <div className="n">{widest ? Number(widest.spread).toFixed(1) : '—'}</div>
            <div className="l">{widest ? `Widest split: ${pad(widest.number)}. ${widest.title}` : 'No responses yet'}</div>
          </div>
          <div className="metric">
            <div className="n">{status ? `${status.scored}/${status.total}` : '—'}</div>
            <div className="l">{status ? `Behaviors covered in round ${status.round}, target ${status.target} responses each` : 'Pulse not started'}</div>
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
                <div className="l">{v.name} ({ids.length} behaviors)</div>
                {score && <PulseBar score={Number(score)} spread={0} />}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>Categories</h2>
          <span className="note">Where the behaviors cluster, and where they are thin</span>
        </div>
        <div className="tablewrap">
          <table className="ctable">
            <tbody>
              {categories.map((c) => {
                const ids = behaviors.filter((b) => b.category === c.name).map((b) => b.id);
                const score = rollup(ids);
                return (
                  <tr key={c.name}>
                    <td><CategoryBadge name={c.name} /></td>
                    <td>{c.question}</td>
                    <td className="meta">Behaviors ({ids.length})</td>
                    <td className="meta">{score ? `${score} avg` : 'not scored'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ----------------------------------------------------------- detail scores */

function DetailScores({ ctx }) {
  const { org, openBehavior } = ctx;
  const [pulse, setPulse] = useState([]);
  useEffect(() => { getPulse(org.id).then(setPulse).catch(() => setPulse([])); }, [org.id]);

  const scored = pulse.filter((p) => p.responses > 0).sort((a, b) => a.avg_score - b.avg_score);
  const unscored = pulse.filter((p) => !p.responses);

  return (
    <section>
      <div className="sectionhead">
        <h2>Behavior pulse</h2>
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
          No responses yet. Each person is asked about two behaviors when they sign in, so the
          first numbers arrive as people come through.
        </div>
      )}

      {unscored.length > 0 && (
        <div className="notice">
          Not yet scored this round: {unscored.map((p) => pad(p.number)).join(', ')}.
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------- rhythm iterations */

function RhythmIterations({ ctx }) {
  const { org, rituals, behaviors, openRecord } = ctx;
  const [runs, setRuns] = useState([]);
  const days = org.recent_days ?? 45;

  useEffect(() => { listIterations(org.id).then(setRuns).catch(() => setRuns([])); }, [org.id]);

  const cutoff = Date.now() - days * 86400000;
  const summary = rituals.map((r) => {
    const mine = runs.filter((x) => x.ritual_id === r.id);
    const recent = mine.filter((x) => new Date(x.held_at).getTime() >= cutoff);
    return { ritual: r, total: mine.length, recent: recent.length, last: mine[0] ?? null };
  }).sort((a, b) => (b.last ? new Date(b.last.held_at) : 0) - (a.last ? new Date(a.last.held_at) : 0));

  return (
    <>
      <section>
        <div className="sectionhead">
          <h2>Rituals, by recency</h2>
          <span className="note">Recent means the last {days} days</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Ritual</th><th>Cadence</th><th>Last run</th><th>Recent</th><th>All time</th></tr></thead>
            <tbody>
              {summary.map(({ ritual, total, recent, last }) => (
                <tr key={ritual.id} className={last ? '' : 'flagged'}>
                  <td className="name">{ritual.name}</td>
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
                <div className="t">{r.ritual?.name ?? 'Ritual'}</div>
                <div className="s">
                  {new Date(r.held_at).toLocaleDateString()} / {r.recorded_by_name}
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
    </>
  );
}

/* ---------------------------------------------------------------- coverage */

function Coverage({ ctx }) {
  const { org, behaviors, systems, rituals, openBehavior } = ctx;
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
      </div>

      {gaps.length > 0 && (
        <div className="notice flagnotice">
          {gaps.length} behavior{gaps.length === 1 ? '' : 's'} reinforced in fewer than two systems: {gaps.map((g) => pad(g.number)).join(', ')}.
        </div>
      )}

      <section>
        {view === 'system' ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>#</th><th>Behavior</th>{systems.map((s) => <th key={s.id}>{s.name}</th>)}<th>Status</th></tr>
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
                            {p ? <><span className="mark">{p.cadence}</span><div className="s">{p.owner}</div></>
                              : <span className="gap">&mdash;</span>}
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
                <tr><th>#</th><th>Behavior</th>{rituals.map((r) => <th key={r.id}>{r.name}</th>)}</tr>
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
                          {applied
                            ? (last ? <span className="mark">{last}</span> : <Tag type="warn">not run</Tag>)
                            : <span className="gap">&mdash;</span>}
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
    </>
  );
}
