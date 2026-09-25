import React, { useState, useEffect } from 'react';
import {
  applySystem, savePlacementTemplate, removePlacement,
  applyRitual, unapplyRitual, createRitual, updateRitual, saveRitualPractice,
  updateBehavior, deleteBehavior, listRecognitions, listStories, listIterations, markFluency
} from '../lib/api.js';
import { pad, NumList, Tag, BNum, Modal, Avatar, findPerson, useToast, confirmAction } from '../components/ui.jsx';
import { RecordIteration } from './Cadence.jsx';
import { FluencyBadge, fluencyName, Metronome, Nodes, WeekMarks } from '../components/badges.jsx';
import { useBehaviorBadges, FluencyDetail, PracticeDetail, ConnectionDetail } from '../components/badgeDetails.jsx';
import { termFor } from '../lib/term.js';

const DEFAULT_TERM = termFor(null);


export default function Behavior({ ctx, id }) {
  const { behaviors, systems, rituals, values, categories, canEdit, reload, goto, org, term } = ctx;
  const b = behaviors.find((x) => x.id === id);
  const [modal, setModal] = useState(null);
  const badges = useBehaviorBadges(ctx);

  // Opening the behavior is reading its full description: the first fluency
  // step. The rings then refresh, so the step shows straight away.
  useEffect(() => {
    if (!b) return;
    markFluency(org.id, b.id, 'description').catch(() => {}).finally(() => ctx.refreshActivity());
  }, [org.id, b?.id]);
  const [recent, setRecent] = useState({ stories: [], recognitions: [], iterations: [] });
  const toast = useToast();
  const days = org.recent_days ?? 45;

  useEffect(() => {
    if (!b) return;
    Promise.all([
      listStories(org.id, { behaviorId: b.id }),
      listRecognitions(org.id, { behaviorId: b.id }),
      listIterations(org.id, { behaviorId: b.id })
    ]).then(([stories, recognitions, iterations]) =>
      setRecent({ stories, recognitions, iterations })
    ).catch(() => setRecent({ stories: [], recognitions: [], iterations: [] }));
  }, [org.id, b?.id]);

  if (!b) return <div className="empty">{term.One} not found.</div>;

  const sharedWith = (ritualId) =>
    behaviors.filter((x) => x.id !== b.id && x.rituals.some((r) => r.id === ritualId));

  // Rituals that apply to every behavior belong on every behavior page.
  const universal = rituals.filter((r) => r.applies_to_all);
  const appliedRituals = [...universal, ...b.rituals.filter((r) => !r.applies_to_all)];

  async function drop() {
    if (!(await confirmAction({ title: `Delete ${pad(b.number)}. ${b.title}?`, body: 'Its stories and recognition go with it. This cannot be undone.' }))) return;
    try { await deleteBehavior(b.id); toast('Behavior deleted.'); await reload(); goto('clarity'); }
    catch (e) { toast(e.message); }
  }

  async function detachRitual(ritualId, name) {
    if (!(await confirmAction({ title: `Remove "${name}" from this ${term.one}?`, body: 'The ritual stays available to others.', action: 'Remove' }))) return;
    try { await unapplyRitual(b.id, ritualId); toast(`Ritual removed from this ${term.one}.`); reload(); }
    catch (e) { toast(e.message); }
  }

  return (
    <>
      <div className="dateline">
        <button className="btn ghost small" onClick={() => goto('clarity')}>Back to Clarity</button>
      </div>
      <div className="detailhead">
        <div><h1 className="pagetitle"><BNum n={b.number} /> {b.title}</h1></div>
        {canEdit && (
          <div className="btnrow" style={{ marginTop: 0 }}>
            <button className="btn small" onClick={() => setModal({ kind: 'editBehavior' })}>Edit {term.one}</button>
            <button className="btn ghost small" onClick={drop}>Delete</button>
          </div>
        )}
      </div>
      <div className="tagrow">
        {b.values.map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
        <Tag type="category">{b.category}</Tag>
        {b.placements.length
          ? <Tag type="system">{b.placements.map((p) => p.system).join(', ')}</Tag>
          : <Tag type="warn">No system</Tag>}
        {b.placements.length === 1 && <Tag type="warn">Thin support</Tag>}
        {b.is_example && <Tag type="warn">Example, edit it to make it yours</Tag>}
      </div>
      <p className="lede">{b.description}</p>

      <div className="badgerow">
        <button className="zone zbadge" onClick={() => setModal({ kind: 'fluency' })}
          title={`${fluencyName(badges.fluency[b.id], term)}: how it is earned`}>
          <FluencyBadge f={badges.fluency[b.id]} size={42} />
        </button>
        <div className="chips">
          {badges.connection[b.id] && (
            <button className="chip gold" onClick={() => setModal({ kind: 'connection' })}>
              <Nodes size={13} /> Connection
            </button>
          )}
          <button className="chip gold" onClick={() => setModal({ kind: 'practice' })}>
            <Metronome size={13} /> Practiced {badges.practiced[b.id].count} of {badges.practiced[b.id].of}
            {' '}<WeekMarks marks={badges.practiced[b.id].marks} />
          </button>
        </div>
      </div>

      <div className="block"><h4>Try this</h4><p>{b.quick_tip}</p></div>
      <List title="Coaching tips" items={b.coaching_tips} />
      <List title="Teaching points" items={b.teaching_points} />
      <List title="Questions for discussion" items={b.questions} />

      <div className="block missbox">
        <h4>When we miss</h4><p>{b.failure_state}</p>
        <h4 style={{ marginTop: 14 }}>The rule that makes it real</h4><p>{b.hard_rule}</p>
      </div>

      <section>
        <div className="sectionhead">
          <h2>Rituals</h2>
          <span className="note">
            {canEdit ? (
              <>
                <button className="btn small" onClick={() => setModal({ kind: 'applyRitual' })}>Apply existing</button>
                {' '}
                <button className="btn small" onClick={() => setModal({ kind: 'newRitual' })}>New ritual</button>
              </>
            ) : `${b.rituals.length} applied`}
          </span>
        </div>
        {appliedRituals.length ? appliedRituals.map((r) => {
          const shared = sharedWith(r.id);
          return (
            <div key={r.id} className="placement rit">
              <div className="ph">
                <span className="psys">{r.name}</span>
                <span className="pmeta">{r.owner} / {r.cadence}</span>
              </div>
              <p className="pact">{r.description}</p>
              <div className="tagrow">
                {r.applies_to_all
                  ? <Tag type="ritual">Applies to every {term.one}</Tag>
                  : shared.length
                    ? <Tag type="ritual">Shared with <NumList items={shared} /></Tag>
                    : <Tag type="ritual">Used here only</Tag>}
              </div>
              <div className="btnrow">
                {r.practice
                  ? <button className="btn ghost small" onClick={() => setModal({ kind: 'runRitual', r })}>Open the practice</button>
                  : canEdit
                    ? <button className="btn ghost small" onClick={() => setModal({ kind: 'writePractice', r })}>Write the practice</button>
                    : <button className="btn ghost small" disabled>No practice written</button>}
                {canEdit && (
                  <>
                    <button className="btn ghost small" onClick={() => setModal({ kind: 'editRitual', r })}>Edit ritual</button>
                    {!r.applies_to_all && (
                      <button className="btn ghost small" onClick={() => detachRitual(r.id, r.name)}>Remove</button>
                    )}
                  </>
                )}
              </div>
              {canEdit && (shared.length > 0 || r.applies_to_all) && (
                <p className="meta" style={{ marginTop: 8 }}>
                  Editing this ritual changes it for every {term.one} that uses it.
                </p>
              )}
            </div>
          );
        }) : <div className="empty">No rituals applied. Rituals are the repeatable practices that make this {term.one} happen without anyone remembering to do it.</div>}
      </section>

      <section>
        <div className="sectionhead">
          <h2>Systems</h2>
          <span className="note">
            {canEdit
              ? <button className="btn small" onClick={() => setModal({ kind: 'system' })}>Apply a system</button>
              : `${b.placements.length} applied`}
          </span>
        </div>
        {b.placements.length ? b.placements.map((p) => (
          <div key={p.id} className="placement">
            <div className="ph">
              <span className="psys">{p.system}</span>
              <span className="pmeta">{p.owner} / {p.cadence}</span>
            </div>
            <p className="pact">{p.artifact}</p>
            <div className="btnrow">
              {p.template
                ? <button className="btn ghost small" onClick={() => setModal({ kind: 'runSystem', p })}>Open the template</button>
                : canEdit
                  ? <button className="btn ghost small" onClick={() => setModal({ kind: 'writeTemplate', p })}>Write the template</button>
                  : <button className="btn ghost small" disabled>No template yet</button>}
              {!p.template && (
                <button className="btn ghost small" onClick={() => setModal({ kind: 'runSystem', p })}>Record a run</button>
              )}
              {canEdit && p.template && (
                <button className="btn ghost small" onClick={() => setModal({ kind: 'writeTemplate', p, initial: p.template })}>Edit template</button>
              )}
              {canEdit && (
                <button className="btn ghost small" onClick={async () => {
                  if (!(await confirmAction({ title: `Remove this ${term.one} from ${p.system}?`, body: 'Its template for this system goes with it.', action: 'Remove' }))) return;
                  await removePlacement(p.id); toast('System removed.'); reload();
                }}>Remove</button>
              )}
            </div>
          </div>
        )) : <div className="empty">Not applied to any system yet. A {term.one} with no system placement is a poster.</div>}
        {b.placements.length === 1 && (
          <div className="notice flagnotice">One system only. A {term.one} reinforced in a single system usually fades within a quarter.</div>
        )}
      </section>

      <section>
        <div className="sectionhead">
          <h2>Recent</h2>
          <span className="note">Last {days} days. Open any line for the full record.</span>
        </div>
        <RecentList
          items={[
            ...recent.stories.map((x) => ({
              kind: 'Story', id: x.id, open: 'story', when: x.created_at,
              who: findPerson(ctx.people, { id: x.author_id, name: x.author_name }), whoName: x.author_name,
              lead: x.author_name, text: x.body, extra: (x.story_attachments ?? []).length
            })),
            ...recent.recognitions.map((x) => ({
              kind: 'Recognition', id: x.id, open: 'recognition', when: x.created_at,
              who: findPerson(ctx.people, { id: x.recipient_user_id, name: x.recipient }), whoName: x.recipient,
              lead: `${x.author_name} → ${x.recipient}${x.title ? `: ${x.title}` : ''}`, text: x.body,
              extra: (x.attachments ?? []).length
            })),
            ...recent.iterations.map((x) => ({
              kind: x.system ? 'System run' : 'Iteration', id: x.id, open: 'iteration', when: x.held_at,
              who: findPerson(ctx.people, { id: x.recorded_by, name: x.recorded_by_name }), whoName: x.recorded_by_name,
              lead: x.ritual?.name ?? x.system?.name ?? 'Run',
              text: x.notes || `Run by ${x.recorded_by_name}`, extra: (x.attachments ?? []).length
            }))
          ]}
          onOpen={(kind, id) => ctx.openRecord(kind, id)} term={term} />
      </section>

      {modal?.kind === 'editBehavior' && (
        <BehaviorForm behavior={b} values={values} categories={categories} toast={toast} wide term={term}
          title={`Edit ${term.one}`}
          onClose={() => setModal(null)}
          onSave={async (fields) => { await updateBehavior(b.id, fields); toast(`${term.One} updated.`); setModal(null); reload(); }} />
      )}
      {modal?.kind === 'system' && (
        <ApplySystemForm behavior={b} systems={systems} ctx={ctx} toast={toast}
          onDone={() => { setModal(null); reload(); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'applyRitual' && (
        <ApplyRitualForm behavior={b} rituals={rituals} toast={toast} term={term}
          onDone={() => { setModal(null); reload(); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'newRitual' && (
        <RitualForm title="New ritual" toast={toast} onClose={() => setModal(null)}
          note={`It is created for ${org.name} and applied to this ${term.one}. You can apply it to others later.`}
          onSave={async (fields) => {
            const r = await createRitual(org.id, fields);
            await applyRitual(b.id, r.id);
            toast('Ritual created and applied.'); setModal(null); reload();
          }} />
      )}
      {modal?.kind === 'editRitual' && (
        <RitualForm title="Edit ritual" initial={modal.r} toast={toast} onClose={() => setModal(null)}
          onSave={async (fields) => { await updateRitual(modal.r.id, fields); toast('Ritual updated.'); setModal(null); reload(); }} />
      )}
      {modal?.kind === 'runSystem' && (
        <RecordIteration ctx={ctx} system={{ id: modal.p.systemId, name: modal.p.system }} placement={modal.p}
          readFor={[b.id]} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} toast={toast} />
      )}
      {modal?.kind === 'runRitual' && (
        <RecordIteration ctx={ctx} ritual={modal.r} readFor={[b.id]}
          onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} toast={toast} />
      )}
      {modal?.kind === 'fluency' && (
        <FluencyDetail ctx={ctx} behavior={b} f={badges.fluency[b.id]} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'practice' && (
        <PracticeDetail ctx={ctx} behavior={b} p={badges.practiced[b.id]} scopeName={badges.scopeName}
          sessionId={badges.sessionId} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'connection' && (
        <ConnectionDetail ctx={ctx} behavior={b} scopeName={badges.scopeName}
          recentDays={badges.recentDays} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'writeTemplate' && (
        <TextForm title={modal.initial ? 'Edit the template' : 'Write the template'} label="Template"
          initial={modal.initial ?? ''} onClose={() => setModal(null)}
          onSave={async (text) => { await savePlacementTemplate(modal.p.id, text); toast('Template saved.'); setModal(null); reload(); }} />
      )}
      {modal?.kind === 'writePractice' && (
        <TextForm title="Write the practice" label="The practice" initial=""
          onClose={() => setModal(null)}
          onSave={async (text) => { await saveRitualPractice(modal.r.id, text); toast('Practice saved.'); setModal(null); reload(); }} />
      )}
    </>
  );
}

/** One list, newest first, each row labelled by type. Reading, not posting. */
function RecentList({ items, onOpen, term = DEFAULT_TERM }) {
  const rows = [...items].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 8);
  if (!rows.length) {
    return <div className="empty">Nothing recorded for this {term.one} yet.</div>;
  }
  return (
    <div className="recentlist">
      {rows.map((it) => (
        <button key={`${it.kind}-${it.id}`} className="recentrow" onClick={() => onOpen(it.open, it.id)}>
          <span className={`typetag t-${it.open}`}>{it.kind}</span>
          <span className="rr-main">
            <span className="rr-lead who2"><Avatar person={it.who} name={it.whoName} size={18} />{it.lead}</span>
            <span className="rr-text">{it.text}</span>
          </span>
          <span className="rr-side">
            <span className="rr-when">{new Date(it.when).toLocaleDateString()}</span>
            {it.extra > 0 && <span className="rr-extra">{it.extra} file{it.extra === 1 ? '' : 's'}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function List({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="block">
      <h4>{title}</h4>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** One form for creating and editing a behavior; lists are one item per line. */
export function BehaviorForm({ behavior, values, categories, onSave, onClose, toast, wide, term = DEFAULT_TERM, title = `Edit ${term.one}` }) {
  const [f, setF] = useState({
    number: behavior?.number ?? '',
    title: behavior?.title ?? '',
    description: behavior?.description ?? '',
    category: behavior?.category ?? categories[0]?.name,
    quick_tip: behavior?.quick_tip ?? '',
    coaching_tips: (behavior?.coaching_tips ?? []).join('\n'),
    teaching_points: (behavior?.teaching_points ?? []).join('\n'),
    questions: (behavior?.questions ?? []).join('\n'),
    failure_state: behavior?.failure_state ?? '',
    hard_rule: behavior?.hard_rule ?? '',
    valueIds: (behavior?.values ?? []).map((v) => v.id)
  });
  const [busy, setBusy] = useState(false);

  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const toggleValue = (id) => setF({
    ...f,
    valueIds: f.valueIds.includes(id) ? f.valueIds.filter((x) => x !== id) : [...f.valueIds, id]
  });

  async function save() {
    if (!f.title.trim() || !f.description.trim()) return toast(`A ${term.one} needs a title and a description.`);
    setBusy(true);
    try {
      await onSave({
        number: Number(f.number) || undefined,
        title: f.title.trim(),
        description: f.description.trim(),
        category: f.category,
        quick_tip: f.quick_tip.trim(),
        coaching_tips: lines(f.coaching_tips),
        teaching_points: lines(f.teaching_points),
        questions: lines(f.questions),
        failure_state: f.failure_state.trim(),
        hard_rule: f.hard_rule.trim(),
        valueIds: f.valueIds
      });
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose} wide={wide !== false}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save behavior'}</button>
      </>}>
      <div className="tworow">
        <div>
          <label className="fl">Number</label>
          <input type="text" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        </div>
        <div>
          <label className="fl">Category</label>
          <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <label className="fl">Title, a verb phrase</label>
      <input type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label className="fl">Description</label>
      <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <label className="fl">Values this carries</label>
      <div className="tagrow">
        {values.map((v) => (
          <button key={v.id} className="pill value" aria-pressed={f.valueIds.includes(v.id)}
            onClick={() => toggleValue(v.id)}>{v.name}</button>
        ))}
      </div>
      <label className="fl">Try this</label>
      <input type="text" value={f.quick_tip} onChange={(e) => setF({ ...f, quick_tip: e.target.value })} />
      <label className="fl">Coaching tips, one per line</label>
      <textarea rows={3} value={f.coaching_tips} onChange={(e) => setF({ ...f, coaching_tips: e.target.value })} />
      <label className="fl">Teaching points, one per line</label>
      <textarea rows={3} value={f.teaching_points} onChange={(e) => setF({ ...f, teaching_points: e.target.value })} />
      <label className="fl">Questions for discussion, one per line</label>
      <textarea rows={3} value={f.questions} onChange={(e) => setF({ ...f, questions: e.target.value })} />
      <label className="fl">When we miss</label>
      <textarea rows={2} value={f.failure_state} onChange={(e) => setF({ ...f, failure_state: e.target.value })} />
      <label className="fl">The rule that makes it real</label>
      <textarea rows={2} value={f.hard_rule} onChange={(e) => setF({ ...f, hard_rule: e.target.value })} />
    </Modal>
  );
}

export function RitualForm({ title, initial, note, onSave, onClose, toast }) {
  const [f, setF] = useState({
    name: initial?.name ?? '', cadence: initial?.cadence ?? '', owner: initial?.owner ?? '',
    description: initial?.description ?? '', practice: initial?.practice ?? ''
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim() || !f.cadence.trim() || !f.owner.trim())
      return toast('Name, cadence and owner are required.');
    setBusy(true);
    try { await onSave({ ...f, practice: f.practice.trim() || null }); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save ritual'}</button>
      </>}>
      {note && <p className="quiet">{note}</p>}
      <label className="fl">Name</label>
      <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">Cadence</label>
      <input type="text" placeholder="Every meeting, monthly, yearly"
        value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })} />
      <label className="fl">Owner</label>
      <input type="text" placeholder="Chair, host, each member"
        value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
      <label className="fl">What it is</label>
      <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <label className="fl">The practice</label>
      <textarea rows={8} placeholder="Step by step, in the words people will actually use"
        value={f.practice} onChange={(e) => setF({ ...f, practice: e.target.value })} />
    </Modal>
  );
}

function ApplySystemForm({ behavior, systems, ctx, onDone, onClose, toast }) {
  const used = new Set(behavior.placements.map((p) => p.systemId));
  const available = systems.filter((s) => !used.has(s.id));
  const [f, setF] = useState({ systemId: available[0]?.id, owner: '', cadence: '', artifact: '', template: '' });

  async function save() {
    if (!f.owner.trim() || !f.cadence.trim() || !f.artifact.trim())
      return toast('Owner, cadence and artifact are all required.');
    try {
      await applySystem(ctx.org.id, behavior.id, f);
      toast(f.template ? 'System applied with its template.' : 'System applied.');
      onDone();
    } catch (e) { toast(e.message); }
  }

  return (
    <Modal title="Apply a system" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={!available.length}>Apply system</button>
      </>}>
      {available.length ? (
        <>
          <label className="fl">System category</label>
          <select className="field" value={f.systemId} onChange={(e) => setF({ ...f, systemId: e.target.value })}>
            {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="fl">Owner</label>
          <input type="text" placeholder="Chair, hiring manager, accountability role"
            value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
          <label className="fl">Cadence</label>
          <input type="text" placeholder="Every meeting, at hire, quarterly"
            value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })} />
          <label className="fl">Artifact</label>
          <input type="text" placeholder="The thing that exists: a form, a log, a question"
            value={f.artifact} onChange={(e) => setF({ ...f, artifact: e.target.value })} />
          <label className="fl">Template, optional now</label>
          <textarea rows={6} placeholder="The actual words: the agenda block, the interview question, the checklist item"
            value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} />
        </>
      ) : <div className="empty">Every system category is already applied to this {ctx.term.one}.</div>}
    </Modal>
  );
}

function ApplyRitualForm({ behavior, rituals, onDone, onClose, toast, term = DEFAULT_TERM }) {
  const used = new Set(behavior.rituals.map((r) => r.id));
  const available = rituals.filter((r) => !used.has(r.id));
  const [id, setId] = useState(available[0]?.id);

  async function save() {
    try { await applyRitual(behavior.id, id); toast('Ritual applied. Its practice comes with it.'); onDone(); }
    catch (e) { toast(e.message); }
  }

  return (
    <Modal title="Apply an existing ritual" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        {available.length > 0 && <button className="btn" onClick={save}>Apply ritual</button>}
      </>}>
      <p className="quiet">The practice comes with the ritual. Editing it later updates every {term.one} that uses it.</p>
      {available.length ? (
        <>
          <label className="fl">Ritual</label>
          <select className="field" value={id} onChange={(e) => setId(e.target.value)}>
            {available.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.cadence}</option>)}
          </select>
        </>
      ) : <div className="empty">Every ritual is already applied here. Use "New ritual" to write another.</div>}
    </Modal>
  );
}

function TextForm({ title, label, initial = '', onSave, onClose }) {
  const [text, setText] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => text.trim() && onSave(text.trim())}>Save</button>
      </>}>
      <label className="fl">{label}</label>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
