import React, { useEffect, useState } from 'react';
import {
  createRitual, updateRitual, setRitualBehaviors, recordIteration, listIterations,
  reorderBehaviors, createBehavior, applySystemToBehaviors, savePlacementTemplate, markFluency
} from '../lib/api.js';
import { pad, N, Tag, BNum, BehaviorTag, Modal, Avatar, findPerson, useToast } from '../components/ui.jsx';
import { BehaviorForm } from './Behavior.jsx';
import { Attachments } from './Details.jsx';
import { useListTools, ListBar, MoreButton, searchable, behaviorWords } from '../components/listTools.jsx';
import { termFor } from '../lib/term.js';

const ALL = 'All';

export default function Cadence({ ctx }) {
  const { term } = ctx;
  const [tab, setTab] = useState('week');
  // Fluency rings and streaks read from recorded activity; opening Cadence,
  // or coming back to it, brings them up to date.
  useEffect(() => { ctx.refreshActivity(); }, []);
  return (
    <>
      <div className="dateline">Week of {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>
      <h1 className="pagetitle">Cadence</h1>
      <p className="lede">One {term.one} at a time, carried by practices nobody has to remember.</p>
      <div className="tabs">
        <button className="tab" aria-pressed={tab === 'week'} onClick={() => setTab('week')}>This week</button>
        <button className="tab" aria-pressed={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</button>
        <button className="tab" aria-pressed={tab === 'rotation'} onClick={() => setTab('rotation')}>Rotation</button>
        <button className="tab" aria-pressed={tab === 'rituals'} onClick={() => setTab('rituals')}>Rituals</button>
        <button className="tab" aria-pressed={tab === 'systems'} onClick={() => setTab('systems')}>Systems</button>
      </div>
      {tab === 'week' && <ThisWeek ctx={ctx} />}
      {tab === 'sessions' && <Sessions ctx={ctx} />}
      {tab === 'rotation' && <Rotation ctx={ctx} />}
      {tab === 'rituals' && <Rituals ctx={ctx} />}
      {tab === 'systems' && <Systems ctx={ctx} />}
    </>
  );
}

/* ---------------------------------------------------------------- this week */

function ThisWeek({ ctx }) {
  const { org, behaviors, rituals, canEdit, reload, openRecord, term } = ctx;
  const week = behaviors.find((b) => b.id === org.weekly_behavior_id) ?? behaviors[0];
  // The session script is a ritual that applies to every behavior, so editing
  // it here changes the practice everywhere.
  const session = rituals.find((r) => r.applies_to_all) ?? null;
  const [modal, setModal] = useState(null);
  const [runs, setRuns] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!session) return;
    listIterations(org.id, { ritualId: session.id }).then(setRuns).catch(() => setRuns([]));
  }, [org.id, session?.id, modal]);

  if (!week) return <div className="empty">No {term.many} yet. Add the first one from the Rotation tab.</div>;

  return (
    <>
      <div className="weekwrap">
        <div className="bigcard">
          <h2><BNum n={week.number} /> {week.title}</h2>
          <div className="tagrow">
            {week.values.map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
            <Tag type="category">{week.category}</Tag>
            {week.is_example && <Tag type="warn">Example</Tag>}
          </div>
          <p className="desc">{week.description}</p>
          <div className="rulebox"><div className="lbl">Try this</div><div className="val">{week.quick_tip}</div></div>
          <div className="rulebox"><div className="lbl">The rule that makes it real</div><div className="val">{week.hard_rule}</div></div>

          <div className="btnrow">
            <button className="btn ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Hide the detail' : `Show the full ${term.one}`}
            </button>
          </div>

          {expanded && (
            <div className="expand">
              {week.coaching_tips?.length > 0 && (
                <div className="block"><h4>Coaching tips</h4>
                  <ul>{week.coaching_tips.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              )}
              {week.teaching_points?.length > 0 && (
                <div className="block"><h4>Teaching points</h4>
                  <ul>{week.teaching_points.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              )}
              {week.questions?.length > 0 && (
                <div className="block"><h4>Questions for discussion</h4>
                  <ul>{week.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              )}
              <div className="block"><h4>When we miss</h4><p>{week.failure_state}</p></div>
              <div className="block"><h4>Values it carries</h4>
                <div className="tagrow">{week.values.map((v) => <span key={v.id} className="tag">{v.name}</span>)}</div>
              </div>
              <div className="block"><h4>Systems that hold it</h4>
                {week.placements.length
                  ? <div className="tagrow">{week.placements.map((p) => (
                      <span key={p.id} className="tag">{p.system} ({p.cadence})</span>))}</div>
                  : <p className="quiet">Not applied to any system yet.</p>}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="panel">
            <div className="sectionhead"><h2 className="small">This week's question</h2></div>
            <p className="bigq">{week.questions?.[0]}</p>
          </div>

          <div className="panel" style={{ marginTop: 15 }}>
            <div className="sectionhead">
              <h2 className="small">Practice It</h2>
              <span className="note">
                {canEdit && session && (
                  <button className="btn ghost small" onClick={() => setModal({ kind: 'editSession' })}>Edit the practice</button>
                )}
              </span>
            </div>
            {session ? (
              <>
                <p className="meta">{session.owner} / {session.cadence}</p>
                <pre className="practice">{session.practice}</pre>
                <p className="meta">
                  This is a ritual that applies to every {term.one}. Editing it changes the session for all of them.
                </p>
                <div className="btnrow">
                  <button className="btn" onClick={() => setModal({ kind: 'run', ritual: session, readFor: [week.id], preselect: [week.id] })}>
                    Record an iteration
                  </button>
                </div>
              </>
            ) : <div className="empty">No practice session ritual defined yet.</div>}
          </div>

          {runs.some((r) => (r.behavior_ids ?? []).includes(week.id)) && (
            <div className="panel" style={{ marginTop: 15 }}>
              <div className="sectionhead">
                <h2 className="small">Recent sessions</h2>
                <span className="note">For <N n={week.number} /> ({runs.filter((r) => (r.behavior_ids ?? []).includes(week.id)).length})</span>
              </div>
              <div className="rowlist flat">
                {runs.filter((r) => (r.behavior_ids ?? []).includes(week.id)).slice(0, 5).map((r) => (
                  <div key={r.id} className="row">
                    <div>
                      <div className="t">{new Date(r.held_at).toLocaleDateString()}</div>
                      <div className="tagrow">
                        {(r.behaviors ?? []).map((b) => <BehaviorTag key={b.id} behavior={b} />)}
                      </div>
                      <div className="s who2">
                        <Avatar person={findPerson(ctx.people, { id: r.recorded_by, name: r.recorded_by_name })}
                          name={r.recorded_by_name} size={18} />
                        {r.recorded_by_name}
                      </div>
                    </div>
                    <button className="btn ghost small" onClick={() => openRecord('iteration', r.id)}>Open</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {modal?.kind === 'editSession' && (
        <RitualForm title="Edit the practice session" initial={session} toast={toast}
          onClose={() => setModal(null)}
          onSave={async (fields) => { await updateRitual(session.id, fields); toast('Practice updated.'); setModal(null); reload(); }} />
      )}
      {modal?.kind === 'run' && (
        <RecordIteration ctx={ctx} ritual={modal.ritual} readFor={modal.readFor ?? []} preselect={modal.preselect ?? []}
          onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} toast={toast} />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- sessions */

/**
 * Every recorded run of a ritual or a system, newest first: filtered by value
 * and behavior like the other Cadence tabs, and with the team toggle, search
 * and "See more" that Recognition and Stories use.
 */
function Sessions({ ctx }) {
  const { org, behaviors, values, teams, activity, openRecord, openBehavior, term } = ctx;
  const [value, setValue] = useState(ALL);
  const [behavior, setBehavior] = useState(ALL);
  const byId = Object.fromEntries(behaviors.map((b) => [b.id, b]));
  const teamName = (id) => teams.find((t) => t.id === id)?.name;

  const rows = activity.iterations.filter((it) => {
    const bs = (it.behavior_ids ?? []).map((id) => byId[id]).filter(Boolean);
    if (behavior !== ALL && !bs.some((b) => b.id === behavior)) return false;
    if (value !== ALL && !bs.some((b) => b.values.some((v) => v.name === value))) return false;
    return true;
  });

  const tools = useListTools({
    ctx, rows,
    onTeam: (it, teamId) => it.team_id === teamId,
    text: (it) => searchable(ctx, [
      it.ritual?.name, it.system?.name, it.system ? 'system' : 'ritual', it.notes, it.recorded_by_name,
      teamName(it.team_id), new Date(it.held_at).toLocaleDateString(),
      (it.behavior_ids ?? []).map((id) => behaviorWords(byId[id]))
    ])
  });

  return (
    <section>
      <div className="sectionhead">
        <h2>Sessions</h2>
        <span className="note">Every ritual and system run that has been recorded</span>
      </div>
      <BehaviorValueFilters term={ctx.term} values={values} behaviors={behaviors}
        value={value} setValue={setValue} behavior={behavior} setBehavior={setBehavior} />
      <ListBar ctx={ctx} tools={tools} placeholder={`Search sessions: a ritual, a person, a ${term.one}, a note`} />

      <div className="rowlist">
        {tools.shown.map((it) => (
          <div key={it.id} className="row sessrow">
            <div>
              <div className="t">
                {it.ritual?.name ?? it.system?.name ?? 'Run'}
                <Tag type={it.system ? 'system' : 'ritual'}>{it.system ? 'System' : 'Ritual'}</Tag>
                {teamName(it.team_id) && <Tag type="plain">{teamName(it.team_id)}</Tag>}
              </div>
              <div className="s who2">
                <Avatar person={findPerson(ctx.people, { id: it.recorded_by, name: it.recorded_by_name })}
                  name={it.recorded_by_name} size={18} />
                {it.recorded_by_name} &nbsp;/&nbsp; {new Date(it.held_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <div className="tagrow">
                {(it.behavior_ids ?? []).map((id) => byId[id]).filter(Boolean).map((b) => (
                  <BehaviorTag key={b.id} behavior={b} onClick={() => openBehavior(b.id)} />
                ))}
              </div>
              {it.notes && <p className="quiet" style={{ margin: '6px 0 0' }}>{it.notes}</p>}
              {(it.attachments ?? []).length > 0 && <Attachments files={it.attachments} compact />}
            </div>
            <button className="btn ghost small" onClick={() => openRecord('iteration', it.id)}>Open</button>
          </div>
        ))}
        {!tools.shown.length && <div className="row"><div className="s">Nothing matches.</div></div>}
      </div>
      <MoreButton tools={tools} />
    </section>
  );
}

/* ----------------------------------------------------------------- rotation */

function Rotation({ ctx }) {
  const { org, behaviors, values, categories, canEdit, openBehavior, reload, term } = ctx;
  const [order, setOrder] = useState(behaviors.map((b) => b.id));
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  useEffect(() => { setOrder(behaviors.map((b) => b.id)); }, [behaviors.map((b) => b.id).join(',')]);

  const byId = Object.fromEntries(behaviors.map((b) => [b.id, b]));

  function drop(targetId) {
    if (!dragging || dragging === targetId) return;
    const next = order.filter((id) => id !== dragging);
    next.splice(next.indexOf(targetId), 0, dragging);
    setOrder(next);
  }

  async function save() {
    try {
      await reorderBehaviors(org.id, order);
      toast('Order saved. Numbers follow the order.');
      setEditing(false);
      reload();
    } catch (e) { toast(e.message); }
  }

  return (
    <section>
      <div className="sectionhead">
        <h2>Rotation</h2>
        <span className="note">
          {canEdit && (editing
            ? <>
                <button className="btn small" onClick={save}>Save order</button>{' '}
                <button className="btn ghost small" onClick={() => { setOrder(behaviors.map((b) => b.id)); setEditing(false); }}>Cancel</button>
              </>
            : <>
                <button className="btn ghost small" onClick={() => setEditing(true)}>Reorder</button>{' '}
                <button className="btn small" onClick={() => setAdding(true)}>Add a {term.one}</button>
              </>)}
        </span>
      </div>

      {editing && (
        <div className="notice">Drag a {term.one} to move it. Saving renumbers the list, so the number always matches the order.</div>
      )}

      <div className="rowlist">
        {order.map((id, i) => {
          const b = byId[id];
          if (!b) return null;
          return (
            <div key={id}
              className={`row${editing ? ' draggable' : ''}${dragging === id ? ' dragging' : ''}`}
              draggable={editing}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { e.preventDefault(); drop(id); }}>
              <div>
                <div className="t">
                  {editing && <span className="grip">⠿</span>}
                  <span className="bnum">{editing ? pad(i + 1) : pad(b.number)}.</span> {b.title}
                </div>
                <div className="tagrow">
                  {b.values.map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
                  <Tag type="category">{b.category}</Tag>
                  {b.id === org.weekly_behavior_id && <Tag type="live">This week</Tag>}
                  {b.is_example && <Tag type="warn">Example</Tag>}
                </div>
              </div>
              <div className="rowactions">
                {!editing && <button className="btn ghost small" onClick={() => openBehavior(b.id)}>Open</button>}
              </div>
            </div>
          );
        })}
      </div>

      {adding && (
        <BehaviorForm title={`Add a ${term.one}`} term={term} values={values} categories={categories} toast={toast} wide
          onClose={() => setAdding(false)}
          onSave={async (fields) => {
            const b = await createBehavior(org.id, fields);
            toast(`${term.One} added.`);
            setAdding(false);
            await reload();
            openBehavior(b.id);
          }} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ filters */

/** One label for however many dropdowns follow it: "Behavior / System". */
function BehaviorValueFilters({ term, values, behaviors, counts, value, setValue, behavior, setBehavior,
  categories, category, setCategory, extra, extraLabel }) {
  return (
    <div className="filters">
      <div className="filterline">
        <span className="fl2">Value</span>
        <button className="pill" aria-pressed={value === ALL} onClick={() => setValue(ALL)}>All</button>
        {values.map((v) => (
          <button key={v.id} className="pill" aria-pressed={value === v.name} onClick={() => setValue(v.name)}>
            {v.name}{counts?.[v.name] !== undefined ? ` (${counts[v.name]})` : ''}
          </button>
        ))}
      </div>
      {categories && (
        <div className="filterline">
          <span className="fl2">Category</span>
          <button className="pill" aria-pressed={category === ALL} onClick={() => setCategory(ALL)}>All</button>
          {categories.map((c) => (
            <button key={c.name} className="pill" aria-pressed={category === c.name}
              onClick={() => setCategory(c.name)}>{c.name}</button>
          ))}
        </div>
      )}
      <div className="filterline">
        <span className="fl2">{extraLabel ? `${term.One} / ${extraLabel}` : term.One}</span>
        <select className="field inline" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
          <option value={ALL}>All {term.many}</option>
          {behaviors.map((b) => <option key={b.id} value={b.id}>{pad(b.number)}. {b.title}</option>)}
        </select>
        {extra}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rituals */

function Rituals({ ctx }) {
  const { org, behaviors, values, rituals, canEdit, openBehavior, openRecord, reload } = ctx;
  const [value, setValue] = useState(ALL);
  const [behavior, setBehavior] = useState(ALL);
  const [modal, setModal] = useState(null);
  const [runs, setRuns] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  useEffect(() => { listIterations(org.id).then(setRuns).catch(() => setRuns([])); }, [org.id, modal]);

  const carriers = (r) => behaviors.filter((b) => r.applies_to_all || b.rituals.some((x) => x.id === r.id));
  const runsFor = (r) => runs.filter((x) => x.ritual_id === r.id);

  const list = rituals.filter((r) => {
    const bs = carriers(r);
    if (behavior !== ALL && !bs.some((b) => b.id === behavior)) return false;
    if (value !== ALL && !bs.some((b) => b.values.some((v) => v.name === value))) return false;
    return true;
  });

  return (
    <section>
      <div className="sectionhead">
        <h2>Rituals</h2>
        <span className="note">
          {canEdit && <button className="btn small" onClick={() => setModal({ kind: 'new' })}>New ritual</button>}
        </span>
      </div>
      <p className="lede small">
        Practices written once and applied to any {ctx.term.one} they reinforce. Recording an iteration
        is what feeds recency and count on Conviction.
      </p>

      <BehaviorValueFilters term={ctx.term} values={values} behaviors={behaviors}
        value={value} setValue={setValue} behavior={behavior} setBehavior={setBehavior} />

      {list.map((r) => {
        const bs = carriers(r);
        const mine = runsFor(r);
        const last = mine[0];
        return (
          <div key={r.id} className="placement rit">
            <div className="ph">
              <span className="psys">{r.name}</span>
              <span className="pmeta">{r.owner} / {r.cadence}</span>
            </div>
            <p className="pact">{r.description}</p>
            <div className="tagrow">
              {r.applies_to_all
                ? <Tag type="ritual">Every {ctx.term.one}</Tag>
                : bs.length
                  ? bs.map((b) => <BehaviorTag key={b.id} behavior={b} onClick={() => openBehavior(b.id)} />)
                  : <Tag type="warn">Not applied to any {ctx.term.one}</Tag>}
            </div>
            <div className="tagrow">
              <Tag type="ritual">Iterations ({mine.length})</Tag>
              {last
                ? <Tag type="plain">Last run {new Date(last.held_at).toLocaleDateString()}</Tag>
                : <Tag type="warn">Never recorded</Tag>}
            </div>
            <div className="btnrow">
              <button className="btn small" onClick={() => setModal({
                kind: 'run', ritual: r,
                readFor: r.applies_to_all ? [org.weekly_behavior_id].filter(Boolean) : bs.map((b) => b.id)
              })}>
                Practice It
              </button>
              <button className="btn ghost small" onClick={() => openRecord('ritual', r.id)}>Details</button>
              {canEdit && (
                <button className="btn ghost small" onClick={() => setModal({ kind: 'edit', ritual: r })}>Edit</button>
              )}
            </div>
          </div>
        );
      })}
      {!list.length && <div className="empty">No rituals match that filter.</div>}

      {modal?.kind === 'new' && (
        <RitualForm title="New ritual" toast={toast} term={ctx.term} behaviors={behaviors} onClose={() => setModal(null)}
          onSave={async (fields, behaviorIds) => {
            const r = await createRitual(org.id, fields);
            if (behaviorIds?.length) await setRitualBehaviors(r.id, behaviorIds);
            toast('Ritual created.'); setModal(null); reload();
          }} />
      )}
      {modal?.kind === 'edit' && (
        <RitualForm title="Edit ritual" term={ctx.term} initial={modal.ritual} behaviors={modal.ritual.applies_to_all ? null : behaviors}
          selected={carriers(modal.ritual).map((b) => b.id)} toast={toast} onClose={() => setModal(null)}
          onSave={async (fields, behaviorIds) => {
            await updateRitual(modal.ritual.id, fields);
            if (behaviorIds) await setRitualBehaviors(modal.ritual.id, behaviorIds);
            toast('Ritual updated.'); setModal(null); reload();
          }} />
      )}
      {modal?.kind === 'run' && (
        <RecordIteration ctx={ctx} ritual={modal.ritual} readFor={modal.readFor ?? []} preselect={modal.preselect ?? []}
          onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} toast={toast} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ systems */

function Systems({ ctx }) {
  const { org, behaviors, values, systems, categories, canEdit, openBehavior, reload } = ctx;
  const [value, setValue] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [behavior, setBehavior] = useState(ALL);
  const [system, setSystem] = useState(ALL);
  const [modal, setModal] = useState(null);
  const toast = useToast();

  // Every placement, flattened, so the page can group by system across behaviors.
  const rows = behaviors.flatMap((b) => b.placements.map((p) => ({ b, p })));

  const filtered = value !== ALL || category !== ALL || behavior !== ALL || system !== ALL;

  const visible = rows.filter(({ b, p }) => {
    if (system !== ALL && p.systemId !== system) return false;
    if (behavior !== ALL && b.id !== behavior) return false;
    if (category !== ALL && b.category !== category) return false;
    if (value !== ALL && !b.values.some((v) => v.name === value)) return false;
    return true;
  });

  // Once a filter is on, a system with nothing left in it is noise, not a gap.
  const grouped = systems
    .map((s) => ({ system: s, items: visible.filter(({ p }) => p.systemId === s.id) }))
    .filter((g) => g.items.length || !filtered);

  return (
    <section>
      <div className="sectionhead">
        <h2>Systems</h2>
        <span className="note">
          {canEdit && <button className="btn small" onClick={() => setModal({ kind: 'new' })}>Apply a system</button>}
        </span>
      </div>
      <p className="lede small">
        Where each {ctx.term.one} is built into how the organization already runs, grouped by system.
      </p>

      <BehaviorValueFilters term={ctx.term} values={values} behaviors={behaviors}
        value={value} setValue={setValue} behavior={behavior} setBehavior={setBehavior}
        categories={categories} category={category} setCategory={setCategory}
        extraLabel="System"
        extra={
          <select className="field inline" value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value={ALL}>All systems</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        } />

      {filtered && !visible.length && (
        <div className="empty">Nothing matches that combination.</div>
      )}

      {grouped.map(({ system: s, items }) => (
        <div key={s.id} className="sysgroup">
          <div className="sectionhead">
            <h2 className="small">{s.name}</h2>
            <span className="note">Behaviors ({items.length})</span>
          </div>
          {items.length ? items.map(({ b, p }) => (
            <div key={p.id} className="placement">
              <div className="ph">
                <span className="psys btn2" onClick={() => openBehavior(b.id)}>
                  <span className="bnum">{pad(b.number)}.</span> {b.title}
                </span>
                <span className="pmeta">{p.owner} / {p.cadence}</span>
              </div>
              <p className="pact">{p.artifact}</p>
              {b.is_example && <div className="tagrow"><Tag type="warn">Example</Tag></div>}
              <div className="btnrow">
                {p.template
                  ? <button className="btn ghost small" onClick={() => setModal({ kind: 'runSystem', s, p, b })}>Open the template</button>
                  : <button className="btn ghost small" onClick={() => setModal({ kind: 'runSystem', s, p, b })}>Record a run</button>}
                {!p.template && canEdit && (
                  <button className="btn ghost small" onClick={() => setModal({ kind: 'writeTemplate', p })}>Write the template</button>
                )}
              </div>
            </div>
          )) : <div className="empty">Nothing applied to this system yet.</div>}
        </div>
      ))}

      {modal?.kind === 'new' && (
        <ApplySystemToMany ctx={ctx} onClose={() => setModal(null)} toast={toast}
          onDone={() => { setModal(null); reload(); }} />
      )}
      {modal?.kind === 'runSystem' && (
        <RecordIteration ctx={ctx} system={modal.s} placement={modal.p} readFor={[modal.b.id]}
          onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} toast={toast} />
      )}
      {modal?.kind === 'writeTemplate' && (
        <WriteTemplate placement={modal.p} onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload(); }} toast={toast} />
      )}
    </section>
  );
}

function ApplySystemToMany({ ctx, onClose, onDone, toast }) {
  const { org, systems, behaviors } = ctx;
  const [f, setF] = useState({
    systemId: systems[0]?.id, owner: '', cadence: '', artifact: '', template: '', behaviorIds: []
  });

  const toggle = (id) => setF({
    ...f,
    behaviorIds: f.behaviorIds.includes(id) ? f.behaviorIds.filter((x) => x !== id) : [...f.behaviorIds, id]
  });

  async function save() {
    if (!f.owner.trim() || !f.cadence.trim() || !f.artifact.trim())
      return toast('Owner, cadence and artifact are all required.');
    if (!f.behaviorIds.length) return toast('Pick at least one behavior.');
    try {
      await applySystemToBehaviors(org.id, f.behaviorIds, f);
      toast(`Applied to ${ctx.term.count(f.behaviorIds.length)}.`);
      onDone();
    } catch (e) { toast(e.message); }
  }

  return (
    <Modal title="Apply a system" onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save}>Apply system</button>
      </>}>
      <label className="fl">System category</label>
      <select className="field" value={f.systemId} onChange={(e) => setF({ ...f, systemId: e.target.value })}>
        {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div className="tworow">
        <div>
          <label className="fl">Owner</label>
          <input type="text" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
        </div>
        <div>
          <label className="fl">Cadence</label>
          <input type="text" value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })} />
        </div>
      </div>
      <label className="fl">Artifact</label>
      <input type="text" placeholder="The thing that exists: a form, a log, a question"
        value={f.artifact} onChange={(e) => setF({ ...f, artifact: e.target.value })} />
      <label className="fl">{ctx.term.Many} it reinforces</label>
      <div className="tagrow">
        {behaviors.map((b) => (
          <button key={b.id} className="pill" aria-pressed={f.behaviorIds.includes(b.id)} onClick={() => toggle(b.id)}>
            <N n={b.number} /> {b.title}
          </button>
        ))}
      </div>
      <label className="fl">Template, optional now</label>
      <textarea rows={6} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} />
      <p className="meta" style={{ marginTop: 8 }}>
        The same owner, cadence, artifact and template are written to each {ctx.term.one} you pick.
        Edit any of them individually afterwards from its {ctx.term.one} page.
      </p>
    </Modal>
  );
}

function WriteTemplate({ placement, onClose, onDone, toast }) {
  const [text, setText] = useState(placement.template ?? '');
  return (
    <Modal title="Write the template" onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={async () => {
          if (!text.trim()) return toast('Write the template first.');
          await savePlacementTemplate(placement.id, text.trim());
          toast('Template saved.'); onDone();
        }}>Save template</button>
      </>}>
      <label className="fl">Template</label>
      <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

/* --------------------------------------------------------- shared modals */

export function RitualForm({ title, initial, behaviors, selected = [], note, onSave, onClose, toast, term = termFor(null) }) {
  const [f, setF] = useState({
    name: initial?.name ?? '', cadence: initial?.cadence ?? '', owner: initial?.owner ?? '',
    description: initial?.description ?? '', practice: initial?.practice ?? ''
  });
  const [ids, setIds] = useState(selected);
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  async function save() {
    if (!f.name.trim() || !f.cadence.trim() || !f.owner.trim())
      return toast('Name, cadence and owner are required.');
    setBusy(true);
    try { await onSave({ ...f, practice: f.practice.trim() || null }, behaviors ? ids : null); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save ritual'}</button>
      </>}>
      {note && <p className="quiet">{note}</p>}
      <div className="tworow">
        <div>
          <label className="fl">Name</label>
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="fl">Cadence</label>
          <input type="text" placeholder="Every meeting, monthly, yearly"
            value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })} />
        </div>
      </div>
      <label className="fl">Owner</label>
      <input type="text" placeholder="Chair, host, each member"
        value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
      <label className="fl">What it is</label>
      <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      {behaviors && (
        <>
          <label className="fl">{term.Many} it reinforces</label>
          <div className="tagrow">
            {behaviors.map((b) => (
              <button key={b.id} className="pill" aria-pressed={ids.includes(b.id)} onClick={() => toggle(b.id)}>
                <N n={b.number} /> {b.title}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="fl">The practice</label>
      <textarea rows={10} placeholder="Step by step, in the words people will actually use"
        value={f.practice} onChange={(e) => setF({ ...f, practice: e.target.value })} />
    </Modal>
  );
}

/**
 * Which behaviors a ritual or system can be recorded against: the ones it is
 * connected to. The practice session applies to every behavior.
 */
export function connectedBehaviors(behaviors, { ritual, system }) {
  const active = behaviors.filter((b) => !b.archived);
  if (ritual) return ritual.applies_to_all ? active : active.filter((b) => b.rituals.some((r) => r.id === ritual.id));
  if (system) return active.filter((b) => b.placements.some((p) => p.systemId === system.id));
  return [];
}

/**
 * One dialog for running a ritual or executing a system: it shows the
 * practice or the template, then records the run. Opened from Cadence, from a
 * behavior page, or from a template, it behaves the same way everywhere.
 *
 * Nothing is pre-selected: the person recording says which behaviors the run
 * actually covered. Members see the practice and template without the form,
 * since recording is a leader's job.
 */
export function RecordIteration({ ctx, ritual, system, placement, readFor = [], preselect = [], onClose, onDone, toast }) {
  const { org, behaviors, teams, myTeamId, term } = ctx;
  const options = connectedBehaviors(behaviors, { ritual, system })
    .slice()
    .sort((a, b) => (b.id === org.weekly_behavior_id) - (a.id === org.weekly_behavior_id) || a.number - b.number);
  // Only This Week pre-selects, and only the behavior of the week.
  const [ids, setIds] = useState(() => preselect.filter((id) => options.some((b) => b.id === id)));
  const [teamId, setTeamId] = useState(myTeamId ?? '');
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  // Opening the practice or the template is the reading step of fluency.
  useEffect(() => {
    Promise.all(readFor.map((id) => markFluency(org.id, id, 'template').catch(() => {})))
      .then(() => ctx.refreshActivity());
  }, []);

  const toggle = (id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const name = ritual?.name ?? system?.name;
  const script = ritual ? ritual.practice : placement?.template;

  async function save() {
    if (!ids.length) return toast(`Pick the ${term.many} this run covered.`);
    setBusy(true);
    try {
      await recordIteration(org.id, {
        ritualId: ritual?.id ?? null, systemId: system?.id ?? null, teamId: teamId || null,
        behaviorIds: ids, heldAt: new Date(when).toISOString(), notes: notes.trim(), files
      });
      toast(ritual ? 'Iteration recorded.' : 'System run recorded.');
      onDone();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={ritual ? `Practice It: ${name}` : `Run the system: ${name}`} onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Mark it done'}</button>
      </>}>
      {ritual && <p className="meta">{ritual.owner} / {ritual.cadence}</p>}
      {placement && <p className="meta">{placement.artifact} / {placement.owner} / {placement.cadence}</p>}
      {script
        ? <pre className="practice">{script}</pre>
        : <p className="quiet">{ritual ? 'No practice written yet.' : 'No template written yet.'}</p>}


      {(
        <>
          <div className="tworow">
            <div>
              <label className="fl">When it was run</label>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div>
              <label className="fl">Team</label>
              <select className="field" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">No team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <p className="meta" style={{ marginTop: 6 }}>
            Recorded by {org.displayName}. The team gets the credit toward its streaks.
          </p>

          <label className="fl">{term.Many} this run covered</label>
          {options.length ? (
            <div className="tagrow">
              {options.map((b) => (
                <button key={b.id} className="pill" aria-pressed={ids.includes(b.id)} onClick={() => toggle(b.id)}>
                  <N n={b.number} /> {b.title}{b.id === org.weekly_behavior_id ? ' (this week)' : ''}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              {ritual ? `This ritual is not connected to any ${term.one} yet.` : `This system is not applied to any ${term.one} yet.`}
            </div>
          )}

          <label className="fl">What happened, optional</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="fl">Photo, video or file, optional</label>
          <input type="file" multiple accept="image/*,video/*,.pdf,.docx"
            onChange={(e) => setFiles(Array.from(e.target.files))} />
          {files.length > 0 && (
            <div className="tagrow" style={{ marginTop: 8 }}>
              {files.map((f) => <span key={f.name} className="tag">{f.name}</span>)}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
