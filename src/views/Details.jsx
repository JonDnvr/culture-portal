import React, { useEffect, useState } from 'react';
import {
  getStory, getRecognition, getIteration, getRitual, signAttachment, listIterations,
  updateRitual, setRitualBehaviors
} from '../lib/api.js';
import { pad, Tag, BNum, BehaviorTag, Avatar, findPerson } from '../components/ui.jsx';
import { GoldStar } from '../components/badges.jsx';
import { ShareRecord } from './Connection.jsx';
import { useToast } from '../components/ui.jsx';
import { RecordActions, DraftTag } from '../components/records.jsx';
import { RecordEditor } from './RecordEditor.jsx';
import { dropRitual, RitualForm } from './Cadence.jsx';

/** Shared header: the behavior a record belongs to, with its description. */
function BehaviorHeader({ behavior, ctx }) {
  if (!behavior) return null;
  return (
    <div className="recordhead">
      <h2 className="recordbehavior"><BNum n={behavior.number} /> {behavior.title}</h2>
      <div className="tagrow">
        {(behavior.values ?? []).map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
        <Tag type="category">{behavior.category}</Tag>
      </div>
      <p className="recorddesc">{behavior.description}</p>
      <button className="btn ghost small" onClick={() => ctx.openBehavior(behavior.id)}>
        Open the full {ctx.term.one}
      </button>
    </div>
  );
}

export function Attachments({ files = [], compact = false }) {
  const [urls, setUrls] = useState({});

  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      for (const a of files) {
        try { out[a.id] = await signAttachment(a.storage_path); } catch { /* skipped */ }
      }
      if (live) setUrls(out);
    })();
    return () => { live = false; };
  }, [files.map((f) => f.id).join(',')]);

  if (!files.length) return null;

  return (
    <div className={compact ? 'attachgrid compact' : 'attachgrid'}>
      {files.map((a) => (
        <figure key={a.id ?? a.storage_path} className="attachitem">
          {a.kind === 'image' && urls[a.id] && (
            <a href={urls[a.id]} target="_blank" rel="noreferrer" title={`Open ${a.file_name}`}>
              <img src={urls[a.id]} alt={a.file_name} />
            </a>
          )}
          {a.kind === 'video' && urls[a.id] && <video src={urls[a.id]} controls preload="metadata" />}
          {a.kind === 'file' && (
            urls[a.id]
              ? <a className="filelink" href={urls[a.id]} target="_blank" rel="noreferrer">{a.file_name}</a>
              : <span className="filelink">{a.file_name}</span>
          )}
          {!urls[a.id] && a.kind !== 'file' && (
            <figcaption className="meta">{a.file_name} — too large to keep in local mode</figcaption>
          )}
          {urls[a.id] && a.kind !== 'file' && <figcaption className="meta">{a.file_name}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function useRecord(loader, id) {
  const [row, setRow] = useState(undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => { loader(id).then(setRow).catch(() => setRow(null)); }, [id, version]);
  return [row, () => setVersion((v) => v + 1)];
}

/**
 * Edit, publish and delete at the top of a record's own page, for whoever
 * may. Deleting returns to wherever the record was opened from.
 */
function RecordTools({ ctx, kind, row, reload, extra }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="btnrow recordtools">
        {extra}
        <RecordActions ctx={ctx} kind={kind} row={row} toast={toast}
          onEdit={() => setEditing(true)} onChanged={reload} onDeleted={ctx.back} />
      </div>
      {editing && (
        <RecordEditor ctx={ctx} kind={kind} row={row} toast={toast}
          onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />
      )}
    </>
  );
}

const when = (iso) => new Date(iso).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
});

export function StoryPage({ ctx, id }) {
  const [story, reload] = useRecord(getStory, id);
  if (story === undefined) return <div className="empty">Loading…</div>;
  if (!story) return <div className="empty">That story is no longer here.</div>;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="detailhead">
        <div className="kicker">Story {story.is_draft && <DraftTag />}</div>
        <RecordTools ctx={ctx} kind="story" row={story} reload={reload} />
      </div>
      <BehaviorHeader behavior={story.behavior} ctx={ctx} />
      <p className="byline who2">
        <Avatar person={findPerson(ctx.people, { id: story.author_id, name: story.author_name })} name={story.author_name} size={24} />
        {story.author_name} &nbsp;/&nbsp; {when(story.created_at)}
      </p>
      <p className="recordbody">{story.body}</p>
      <Attachments files={story.story_attachments ?? []} />
    </article>
  );
}

export function RecognitionPage({ ctx, id }) {
  const [rec, reload] = useRecord(getRecognition, id);
  const [sharing, setSharing] = useState(false);
  const toast = useToast();
  if (rec === undefined) return <div className="empty">Loading…</div>;
  if (!rec) return <div className="empty">That recognition is no longer here.</div>;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="detailhead">
        <div className="kicker">Recognition {rec.is_draft && <DraftTag />}</div>
        <RecordTools ctx={ctx} kind="recognition" row={rec} reload={reload}
          extra={!rec.is_draft && <button className="btn ghost small" onClick={() => setSharing(true)}>Share by email</button>} />
      </div>
      <BehaviorHeader behavior={rec.behavior} ctx={ctx} />
      <div className="recordwho who2">
        <Avatar person={findPerson(ctx.people, { id: rec.recipient_user_id, name: rec.recipient })} name={rec.recipient} size={36} />
        <span>
          <h3 className="recordwho" style={{ margin: 0 }}>{rec.recipient}</h3>
          {rec.title && <span className="rectitle">{rec.recipient_user_id && <GoldStar size={16} />} {rec.title}</span>}
        </span>
      </div>
      <p className="byline who2">
        <Avatar person={findPerson(ctx.people, { id: rec.author_id, name: rec.author_name })} name={rec.author_name} size={20} />
        Recognized by {rec.author_name} &nbsp;/&nbsp; {when(rec.created_at)}
      </p>
      <p className="recordbody">{rec.body}</p>
      <Attachments files={rec.attachments ?? []} />
      {sharing && (
        <ShareRecord kind="recognition" id={rec.id} onClose={() => setSharing(false)} toast={toast}
          summary={<p className="rectitle">{rec.recipient_user_id && <GoldStar size={16} />} {rec.title || rec.recipient}</p>} />
      )}
    </article>
  );
}

export function IterationPage({ ctx, id }) {
  const [it, reload] = useRecord(getIteration, id);
  if (it === undefined) return <div className="empty">Loading…</div>;
  if (!it) return <div className="empty">That iteration is no longer here.</div>;

  const behavior = it.behaviors?.[0] ?? null;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="detailhead">
        <div className="kicker">{it.system ? 'System run' : 'Ritual iteration'} {it.is_draft && <DraftTag />}</div>
        <RecordTools ctx={ctx} kind="iteration" row={it} reload={reload} />
      </div>
      <BehaviorHeader behavior={behavior} ctx={ctx} />

      <div className="recordpanel">
        {it.system ? (
          <>
            <h3 className="recordwho">{it.system.name}</h3>
            {it.system.artifact && <p className="meta">{it.system.artifact} / {it.system.owner} / {it.system.cadence}</p>}
            {it.system.template && <pre className="practice">{it.system.template}</pre>}
          </>
        ) : (
          <>
            <h3 className="recordwho">{it.ritual?.name ?? 'Ritual'}</h3>
            <p className="meta">{it.ritual?.owner} / {it.ritual?.cadence}</p>
            {it.ritual && (
              <button className="btn ghost small" onClick={() => ctx.openRecord('ritual', it.ritual.id)}>
                Open the ritual
              </button>
            )}
          </>
        )}
      </div>

      <p className="byline who2">
        <Avatar person={findPerson(ctx.people, { id: it.recorded_by, name: it.recorded_by_name })} name={it.recorded_by_name} size={22} />
        Recorded by {it.recorded_by_name}
        {ctx.teams.find((t) => t.id === it.team_id) ? ` for ${ctx.teams.find((t) => t.id === it.team_id).name}` : ''}
        &nbsp;/&nbsp; run {when(it.held_at)}
      </p>
      {it.behaviors?.length > 1 && (
        <div className="tagrow">
          {it.behaviors.map((b) => (
            <BehaviorTag key={b.id} behavior={b} onClick={() => ctx.openBehavior(b.id)} />
          ))}
        </div>
      )}
      {it.notes
        ? <p className="recordbody">{it.notes}</p>
        : <p className="quiet">No notes were written for this run.</p>}
      <Attachments files={it.attachments ?? []} />
    </article>
  );
}

export function RitualPage({ ctx, id }) {
  const [ritual, reload] = useRecord(getRitual, id);
  const [runs, setRuns] = useState([]);
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!ritual) return;
    listIterations(ctx.org.id, { ritualId: ritual.id }).then(setRuns).catch(() => setRuns([]));
  }, [ritual?.id]);

  if (ritual === undefined) return <div className="empty">Loading…</div>;
  if (!ritual) return <div className="empty">That ritual is no longer here.</div>;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="detailhead">
        <div className="kicker">Ritual</div>
        {ctx.canEdit && (
          <div className="btnrow recordtools">
            <button className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>
            {!ritual.applies_to_all && (
              <button className="btn ghost small danger" onClick={async () => {
                if (await dropRitual(ctx, ritual, toast)) ctx.back();
              }}>Delete</button>
            )}
          </div>
        )}
      </div>
      <h2 className="recordbehavior">{ritual.name}</h2>
      <p className="byline">{ritual.owner} &nbsp;/&nbsp; {ritual.cadence}</p>
      <p className="recordbody">{ritual.description}</p>

      {ritual.applies_to_all
        ? <div className="tagrow"><Tag type="ritual">Applies to every {ctx.term.one}</Tag></div>
        : (
          <div className="tagrow">
            {ritual.behaviors.map((b) => (
              <BehaviorTag key={b.id} behavior={b} onClick={() => ctx.openBehavior(b.id)} />
            ))}
          </div>
        )}

      {ritual.practice && (
        <div className="block">
          <h4>The practice</h4>
          <pre>{ritual.practice}</pre>
        </div>
      )}

      <section>
        <div className="sectionhead">
          <h2>Iterations</h2><span className="note">Recorded ({runs.length})</span>
        </div>
        {runs.length ? (
          <div className="rowlist">
            {runs.map((r) => (
              <div key={r.id} className="row">
                <div>
                  <div className="t">{new Date(r.held_at).toLocaleDateString()}</div>
                  <div className="s who2">
                    <Avatar person={findPerson(ctx.people, { id: r.recorded_by, name: r.recorded_by_name })} name={r.recorded_by_name} size={18} />
                    {r.recorded_by_name}{r.notes ? ` / ${r.notes.slice(0, 80)}` : ''}
                  </div>
                </div>
                <button className="btn ghost small" onClick={() => ctx.openRecord('iteration', r.id)}>Open</button>
              </div>
            ))}
          </div>
        ) : <div className="empty">Not run yet, or not recorded.</div>}
      </section>
      {editing && (
        <RitualForm title="Edit ritual" term={ctx.term} initial={ritual} toast={toast}
          behaviors={ritual.applies_to_all ? null : ctx.behaviors} selected={(ritual.behaviors ?? []).map((b) => b.id)}
          onClose={() => setEditing(false)}
          onSave={async (fields, behaviorIds) => {
            await updateRitual(ritual.id, fields);
            if (behaviorIds) await setRitualBehaviors(ritual.id, behaviorIds);
            toast('Ritual updated.'); setEditing(false); reload(); ctx.reload();
          }} />
      )}
    </article>
  );
}
