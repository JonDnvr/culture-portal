import React, { useEffect, useState } from 'react';
import {
  getStory, getRecognition, getIteration, getRitual, signAttachment, listIterations
} from '../lib/api.js';
import { pad, Tag, BNum, BehaviorTag } from '../components/ui.jsx';

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
        Open the full behavior
      </button>
    </div>
  );
}

export function Attachments({ files = [] }) {
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
    <div className="attachgrid">
      {files.map((a) => (
        <figure key={a.id} className="attachitem">
          {a.kind === 'image' && urls[a.id] && <img src={urls[a.id]} alt={a.file_name} />}
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
  useEffect(() => { loader(id).then(setRow).catch(() => setRow(null)); }, [id]);
  return row;
}

const when = (iso) => new Date(iso).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
});

export function StoryPage({ ctx, id }) {
  const story = useRecord(getStory, id);
  if (story === undefined) return <div className="empty">Loading…</div>;
  if (!story) return <div className="empty">That story is no longer here.</div>;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="kicker">Story</div>
      <BehaviorHeader behavior={story.behavior} ctx={ctx} />
      <p className="byline">{story.author_name} &nbsp;/&nbsp; {when(story.created_at)}</p>
      <p className="recordbody">{story.body}</p>
      <Attachments files={story.story_attachments ?? []} />
    </article>
  );
}

export function RecognitionPage({ ctx, id }) {
  const rec = useRecord(getRecognition, id);
  if (rec === undefined) return <div className="empty">Loading…</div>;
  if (!rec) return <div className="empty">That recognition is no longer here.</div>;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="kicker">Recognition</div>
      <BehaviorHeader behavior={rec.behavior} ctx={ctx} />
      <h3 className="recordwho">{rec.recipient}</h3>
      <p className="byline">Recognized by {rec.author_name} &nbsp;/&nbsp; {when(rec.created_at)}</p>
      <p className="recordbody">{rec.body}</p>
      <Attachments files={rec.attachments ?? []} />
    </article>
  );
}

export function IterationPage({ ctx, id }) {
  const it = useRecord(getIteration, id);
  if (it === undefined) return <div className="empty">Loading…</div>;
  if (!it) return <div className="empty">That iteration is no longer here.</div>;

  const behavior = it.behaviors?.[0] ?? null;

  return (
    <article className="record">
      <div className="dateline">
        <button className="btn ghost small" onClick={ctx.back}>Back</button>
      </div>
      <div className="kicker">Ritual iteration</div>
      <BehaviorHeader behavior={behavior} ctx={ctx} />

      <div className="recordpanel">
        <h3 className="recordwho">{it.ritual?.name ?? 'Ritual'}</h3>
        <p className="meta">{it.ritual?.owner} / {it.ritual?.cadence}</p>
        {it.ritual && (
          <button className="btn ghost small" onClick={() => ctx.openRecord('ritual', it.ritual.id)}>
            Open the ritual
          </button>
        )}
      </div>

      <p className="byline">Recorded by {it.recorded_by_name} &nbsp;/&nbsp; run {when(it.held_at)}</p>
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
  const ritual = useRecord(getRitual, id);
  const [runs, setRuns] = useState([]);

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
      <div className="kicker">Ritual</div>
      <h2 className="recordbehavior">{ritual.name}</h2>
      <p className="byline">{ritual.owner} &nbsp;/&nbsp; {ritual.cadence}</p>
      <p className="recordbody">{ritual.description}</p>

      {ritual.applies_to_all
        ? <div className="tagrow"><Tag type="ritual">Applies to every behavior</Tag></div>
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
                  <div className="s">{r.recorded_by_name}{r.notes ? ` / ${r.notes.slice(0, 80)}` : ''}</div>
                </div>
                <button className="btn ghost small" onClick={() => ctx.openRecord('iteration', r.id)}>Open</button>
              </div>
            ))}
          </div>
        ) : <div className="empty">Not run yet, or not recorded.</div>}
      </section>
    </article>
  );
}
