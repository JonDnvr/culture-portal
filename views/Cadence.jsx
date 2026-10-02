import React, { useEffect, useState } from 'react';
import {
  createRitual, updateRitual, deleteRitual, setRitualBehaviors, recordIteration, updateIteration, listIterations,
  reorderBehaviors, createBehavior, applySystemToBehaviors, savePlacementTemplate, markFluency,
  updatePlacement, removePlacement
} from '../lib/api.js';
import { pad, N, Tag, BNum, BehaviorTag, Modal, Avatar, findPerson, useToast, confirmAction, celebrate } from '../components/ui.jsx';
import { RecordActions, FormButtons, FileEditor, formMode } from '../components/records.jsx';
import { DraftsPanel, RecordEditor } from './RecordEditor.jsx';
import { BehaviorForm } from './Behavior.jsx';
import { Attachments } from './Details.jsx';
import { useListTools, ListBar, MoreButton, searchable, behaviorWords } from '../components/listTools.jsx';
import { termFor } from '../lib/term.js';
import { cadenceOf, UNIT } from '../lib/gamify.js';
import { inCategory, categoriesOf } from '../lib/categories.js';

const ALL = 'All';

export default function Cadence({ ctx }) {
  const { term } = ctx;
  // A tag clicked elsewhere lands here on Rituals or Systems, filtered to one behavior.
  const [hint] = useState(() => { const h = window.__cpCadence; window.__cpCadence = null; return h ?? null; });
  const [tab, setTab] = useState(hint?.tab ?? 'week');
  // Fluency rings and streaks read from recorded activity; opening Cadence,
  // or coming back to it, brings them up to date.
  useEffect(() => { ctx.refreshActivity(); }, []);
  return (
    <>
      <div className="dateline">
        {hint?.back
          ? <button className="btn ghost small" onClick={ctx.back}>Back</button>
          : `Week of ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`}
      </div>
      <h1 className="pagetitle">Cadence</h1>
      <p className="lede">One {term.one} at a time, carried by practices nobody has to remember.</p>
      <div className="tabs">
        <button className="tab" aria-pressed={tab === 'week'} onClick={() => setTab('week')}>{UNIT[cadenceOf(ctx.org).kind].this.replace(/^./, (c) => c.toUpperCase())}</button>
        <button className="tab" aria-pressed={tab === 'rituals'} onClick={() => setTab('rituals')}>Rituals</button>
        <button className="tab" aria-pressed={tab === 'systems'} onClick={() => setTab('systems')}>Systems</button>
        <button className="tab" aria-pressed={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</button>
      </div>
      {tab === 'week' && <ThisWeek ctx={ctx} />}
      {tab === 'sessions' && <Sessions ctx={ctx} />}
      {tab === 'rituals' && <Rituals ctx={ctx} initialBehavior={hint?.tab === 'rituals' ? hint.behavior : null} />}
      {tab === 'systems' && <Systems ctx={ctx} initialBehavior={hint?.tab === 'systems' ? hint.behavior : null} />}
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

  if (!week) return <div className="empty">No {term.many} yet. Add the first one from Admin, Rotation.</div>;

  return (
    <>
      <div className="weekwrap">
        <div className="bigcard">
          <h2><BNum n={week.number} /> {week.title}</h2>
          <div className="tagrow">
            {week.values.map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
            {categoriesOf(week).map((c) => <Tag key={c} type="category">{c}</Tag>)}
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
                    Run a Session
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
  const { behaviors, values, systems, categories, teams, activity, openRecord, openBehavior, term } = ctx;
  const [kind, setKind] = useState(ALL);
  const [value, setValue] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [behavior, setBehavior] = useState(ALL);
  const [system, setSystem] = useState(ALL);
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const byId = Object.fromEntries(behaviors.map((b) => [b.id, b]));
  const teamName = (id) => teams.find((t) => t.id === id)?.name;
  const isSystem = (it) => !!(it.system_category_id ?? it.system);

  const rows = activity.iterations.filter((it) => {
    const bs = (it.behavior_ids ?? []).map((id) => byId[id]).filter(Boolean);
    if (kind === 'ritual' && isSystem(it)) return false;
    if (kind === 'system' && !isSystem(it)) return false;
    if (system !== ALL && (it.system_category_id ?? it.system?.id) !== system) return false;
    if (behavior !== ALL && !bs.some((b) => b.id === behavior)) return false;
    if (category !== ALL && !bs.some((b) => inCategory(b, category))) return false;
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
      <DraftsPanel ctx={ctx} kind="iteration" title="Your draft sessions" />
      <div className="filters">
        <div className="filterline">
          <span className="fl2">Show</span>
          {[ALL, 'ritual', 'system'].map((k) => (
            <button key={k} className="pill" aria-pressed={kind === k} onClick={() => {
              setKind(k);
              // Rituals only: a system picked below would leave nothing to show.
              if (k === 'ritual') setSystem(ALL);
            }}>
              {k === ALL ? 'All' : k === 'ritual' ? 'Rituals' : 'Systems'}
            </button>
          ))}
        </div>
      </div>
      <BehaviorValueFilters term={ctx.term} values={values} behaviors={behaviors}
        value={value} setValue={setValue} behavior={behavior} setBehavior={setBehavior}
        categories={ctx.showCats ? categories : null} category={category} setCategory={setCategory}
        extraLabel="System"
        extra={
          <select className="field inline" value={system} disabled={kind === 'ritual'}
            onChange={(e) => { setSystem(e.target.value); if (e.target.value !== ALL) setKind('system'); }}>
            <option value={ALL}>All systems</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        } />
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
            <div className="rowactions">
              <button className="btn ghost small" onClick={() => openRecord('iteration', it.id)}>Open</button>
              <RecordActions ctx={ctx} kind="iteration" row={it} toast={toast} onEdit={setEditing} />
            </div>
          </div>
        ))}
        {!tools.shown.length && <div className="row"><div className="s">Nothing matches.</div></div>}
      </div>
      <MoreButton tools={tools} />
      {editing && (
        <RecordEditor ctx={ctx} kind="iteration" row={editing} toast={toast}
          onClose={() => setEditing(null)} onDone={() => setEditing(null)} />
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- rotation */

export function Rotation({ ctx }) {
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
                <div className="t rotline">
                  {editing && <span className="grip">⠿</span>}
                  <span className="rottitle"><span className="bnum">{editing ? pad(i + 1) : pad(b.number)}.</span> {b.title}</span>
                  {b.description && <span className="rotdesc">{b.description}</span>}
                </div>
                <div className="tagrow">
                  {b.values.map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
                  {categoriesOf(b).map((c) => <Tag key={c} type="category">{c}</Tag>)}
                  {b.id === org.weekly_behavior_id && <Tag type="live">Featured now</Tag>}
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

function Rituals({ ctx, initialBehavior = null }) {
  const { org, behaviors, values, rituals, categories, canEdit, openBehavior, openRecord, reload } = ctx;
  const [value, setValue] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [behavior, setBehavior] = useState(initialBehavior ?? ALL);
  const [modal, setModal] = useState(null);
  const [runs, setRuns] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  useEffect(() => { listIterations(org.id).then(setRuns).catch(() => setRuns([])); }, [org.id, modal]);

  const carriers = (r) => behaviors.filter((b) => r.applies_to_all || b.rituals.some((x) => x.id === r.id));
  const runsFor = (r) => runs.filter((x) => x.ritual_id === r.id);

  // A ritual matches when any behavior it carries does.
  const list = rituals.filter((r) => {
    const bs = carriers(r);
    if (behavior !== ALL && !bs.some((b) => b.id === behavior)) return false;
    if (category !== ALL && !bs.some((b) => inCategory(b, category))) return false;
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
        value={value} setValue={setValue} behavior={behavior} setBehavior={setBehavior}
        categories={ctx.showCats ? categories : null} category={category} setCategory={setCategory} />

      {list.map((r) => {
        const bs = carriers(r);
        const mine = runsFor(r);
        const last = mine[0];
        return (
          <div key={r.id} className="placement rit">
            <div className="ph">
              <span className="psys">{r.name}{r.is_example && <> <Tag type="warn">Example</Tag></>}</span>
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
              {canEdit && !r.applies_to_all && (
                <button className="btn ghost small danger" onClick={() => dropRitual(ctx, r, toast)}>Delete</button>
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

/**
 * Removes a ritual from the organization, after asking. Its recorded
 * iterations stay in the record; the practice session is never deleted,
 * because This Week depends on it.
 */
export async function dropRitual(ctx, r, toast) {
  const ok = await confirmAction({
    title: `Delete the ritual "${r.name}"?`,
    body: `It comes off every ${ctx.term.one} it is applied to. Iterations already recorded stay in the record. This cannot be undone.`
  });
  if (!ok) return false;
  try { await deleteRitual(r.id); toast('Ritual deleted.'); await ctx.reload(); return true; }
  catch (e) { toast(e.message); return false; }
}

/* ------------------------------------------------------------------ systems */

function Systems({ ctx, initialBehavior = null }) {
  const { org, behaviors, values, systems, categories, canEdit, openBehavior, reload } = ctx;
  const [value, setValue] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [behavior, setBehavior] = useState(initialBehavior ?? ALL);
  const [system, setSystem] = useState(ALL);
  const [modal, setModal] = useState(null);
  const toast = useToast();

  // Every placement, flattened, so the page can group by system across behaviors.
  const rows = behaviors.flatMap((b) => b.placements.map((p) => ({ b, p })));

  const filtered = value !== ALL || category !== ALL || behavior !== ALL || system !== ALL;

  const visible = rows.filter(({ b, p }) => {
    if (system !== ALL && p.systemId !== system) return false;
    if (behavior !== ALL && b.id !== behavior) return false;
    if (category !== ALL && !inCategory(b, category)) return false;
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
        categories={ctx.showCats ? categories : null} category={category} setCategory={setCategory}
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
              <div className="tagrow">
                {b.is_example && <Tag type="warn">Example</Tag>}
                {p.template ? <Tag type="system">Template written</Tag> : <Tag type="warn">No template yet</Tag>}
              </div>
              <div className="btnrow">
                <button className="btn small" onClick={() => setModal({ kind: 'runSystem', s, p, b })}>Practice It</button>
                <button className="btn ghost small" onClick={() => ctx.openRecord('placement', p.id)}>Details</button>
                {canEdit && (
                  <button className="btn ghost small" onClick={() => setModal({ kind: 'editPlacement', s, p, b })}>Edit</button>
                )}
                {canEdit && (
                  <button className="btn ghost small danger" onClick={() => dropPlacement(ctx, b, s, p, toast)}>Delete</button>
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
      {modal?.kind === 'editPlacement' && (
        <PlacementForm ctx={ctx} system={modal.s} placement={modal.p} behavior={modal.b} toast={toast}
          onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />
      )}
    </section>
  );
}

/** Takes a behavior out of a system, after asking. Recorded runs stay. */
export async function dropPlacement(ctx, b, s, p, toast) {
  const ok = await confirmAction({
    title: `Remove ${pad(b.number)}. ${b.title} from ${s?.name ?? p.system}?`,
    body: 'Its template for this system goes with it. Runs already recorded stay in the record. This cannot be undone.'
  });
  if (!ok) return false;
  try { await removePlacement(p.id); toast('Removed from the system.'); await ctx.reload(); return true; }
  catch (e) { toast(e.message); return false; }
}

/** Edit how a behavior is built into a system: who, how often, what happens, the template. */
export function PlacementForm({ ctx, system, placement, behavior, toast, onClose, onDone }) {
  const [f, setF] = useState({
    owner: placement.owner ?? '', cadence: placement.cadence ?? '',
    artifact: placement.artifact ?? '', template: placement.template ?? ''
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.owner.trim() || !f.cadence.trim() || !f.artifact.trim()) return toast('Owner, cadence and what happens are all required.');
    try { await updatePlacement(placement.id, { ...f, template: f.template.trim() || null }); toast('System placement saved.'); onDone(); }
    catch (e) { toast(e.message); }
  }
  return (
    <Modal title={`Edit ${system?.name ?? placement.system}: ${pad(behavior.number)}. ${behavior.title}`} onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></>}>
      <div className="tworow">
        <div><label className="fl">Owner</label><input type="text" value={f.owner} onChange={set('owner')} /></div>
        <div><label className="fl">Cadence</label><input type="text" value={f.cadence} onChange={set('cadence')} /></div>
      </div>
      <label className="fl">What happens</label>
      <input type="text" value={f.artifact} onChange={set('artifact')} />
      <label className="fl">Template, optional</label>
      <textarea rows={8} value={f.template} onChange={set('template')}
        placeholder="The questions, checklist or script people follow when they run it." />
    </Modal>
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
export function RecordIteration({ ctx, ritual, system, placement, readFor = [], preselect = [], initial = null, onClose, onDone, toast }) {
  const { org, behaviors, teams, myTeamId, term } = ctx;
  const mode = formMode(initial);
  const connected = connectedBehaviors(behaviors, { ritual, system });
  // Editing keeps whatever the run already covered, even if a ritual has
  // since been taken off one of them.
  const extra = initial ? behaviors.filter((b) => (initial.behavior_ids ?? []).includes(b.id) && !connected.includes(b)) : [];
  const options = [...connected, ...extra]
    .slice()
    .sort((a, b) => (b.id === org.weekly_behavior_id) - (a.id === org.weekly_behavior_id) || a.number - b.number);
  // Only This Week pre-selects, and only the behavior of the week.
  const [ids, setIds] = useState(() => initial ? [...(initial.behavior_ids ?? [])]
    : preselect.filter((id) => options.some((b) => b.id === id)));
  const [teamId, setTeamId] = useState(initial ? (initial.team_id ?? '') : (myTeamId ?? ''));
  const [when, setWhen] = useState(() => {
    const d = initial ? new Date(initial.held_at) : new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [files, setFiles] = useState([]);
  const [removeIds, setRemoveIds] = useState([]);
  const [busy, setBusy] = useState(false);

  // Opening the practice or the template is the reading step of fluency.
  useEffect(() => {
    if (initial) return;
    Promise.all(readFor.map((id) => markFluency(org.id, id, 'template').catch(() => {})))
      .then(() => ctx.refreshActivity());
  }, []);

  const toggle = (id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const name = ritual?.name ?? system?.name;
  const script = ritual ? ritual.practice : placement?.template;

  async function save(asDraft) {
    if (!ids.length) return toast(`Pick the ${term.many} this run covered.`);
    setBusy(true);
    try {
      if (initial) {
        await updateIteration(initial.id, {
          behaviorIds: ids, teamId: teamId || null, heldAt: new Date(when).toISOString(), notes: notes.trim(),
          isDraft: mode === 'published' ? undefined : asDraft, addFiles: files, removeFileIds: removeIds
        });
      } else {
        await recordIteration(org.id, {
          ritualId: ritual?.id ?? null, systemId: system?.id ?? null, teamId: teamId || null,
          behaviorIds: ids, heldAt: new Date(when).toISOString(), notes: notes.trim(), files, isDraft: asDraft
        });
      }
      toast(mode === 'published' ? 'Changes saved.'
        : asDraft ? 'Saved as a draft. Publish it from your top account dropdown.'
          : ritual ? 'Session published.' : 'System run published.');
      if (!asDraft && mode !== 'published') celebrate();
      await ctx.refreshActivity();
      onDone();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  const heading = initial
    ? `${mode === 'draft' ? 'Draft' : 'Edit'}: ${name ?? 'session'}`
    : ritual ? `Practice It: ${name}` : `Run the system: ${name}`;

  return (
    <Modal title={heading} onClose={onClose} wide
      footer={<FormButtons mode={mode} busy={busy} onCancel={onClose} onSave={save} publishLabel="Publish Session" />}>
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
            Recorded by {initial ? initial.recorded_by_name : org.displayName}. The team gets the credit toward its streaks.
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
          <FileEditor id="runFiles" existing={initial?.attachments ?? []} removeIds={removeIds}
            setRemoveIds={setRemoveIds} files={files} setFiles={setFiles} />
        </>
      )}
    </Modal>
  );
}
