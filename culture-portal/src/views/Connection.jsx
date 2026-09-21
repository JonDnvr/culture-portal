import React, { useEffect, useState } from 'react';
import {
  listStories, createStory, listRecognitions, createRecognition, shareStoryByEmail,
  deleteStory, deleteRecognition, listMemberEmails
} from '../lib/api.js';
import { pad, Tag, BehaviorTag, Modal, useToast } from '../components/ui.jsx';

const PREVIEW = 260;

const byIdExample = (ctx, id) => !!ctx.behaviors.find((b) => b.id === id)?.is_example;

/** First 260 characters, with a flag when there is more to read. */
function preview(text = '') {
  const clean = text.trim();
  return clean.length > PREVIEW
    ? { text: clean.slice(0, PREVIEW).trimEnd() + '…', more: true }
    : { text: clean, more: false };
}

const ALL = 'All';

export default function Connection({ ctx }) {
  const [tab, setTab] = useState('recognition');
  return (
    <>
      <div className="dateline">Behavior named out loud, and the record of it happening</div>
      <h1 className="pagetitle">Connection</h1>
      <p className="lede">Recognition tells people which behaviors matter. Stories are how behaviors become beliefs.</p>
      <div className="tabs">
        <button className="tab" aria-pressed={tab === 'recognition'} onClick={() => setTab('recognition')}>Recognition</button>
        <button className="tab" aria-pressed={tab === 'stories'} onClick={() => setTab('stories')}>Stories</button>
      </div>
      {tab === 'recognition' ? <Recognition ctx={ctx} /> : <Stories ctx={ctx} />}
    </>
  );
}

/** Value pills and a behavior dropdown, the same pattern as Clarity. */
function Filters({ ctx, value, setValue, behavior, setBehavior }) {
  const { values, behaviors } = ctx;
  return (
    <div className="filters">
      <div className="filterline">
        <span className="fl2">Value</span>
        <button className="pill" aria-pressed={value === ALL} onClick={() => setValue(ALL)}>All</button>
        {values.map((v) => (
          <button key={v.id} className="pill" aria-pressed={value === v.name} onClick={() => setValue(v.name)}>
            {v.name}
          </button>
        ))}
      </div>
      <div className="filterline">
        <span className="fl2">Behavior</span>
        <select className="field inline" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
          <option value={ALL}>All behaviors</option>
          {behaviors.map((b) => <option key={b.id} value={b.id}>{pad(b.number)}. {b.title}</option>)}
        </select>
      </div>
    </div>
  );
}

function useFilter(ctx, rows) {
  const [value, setValue] = useState(ALL);
  const [behavior, setBehavior] = useState(ALL);
  const byId = Object.fromEntries(ctx.behaviors.map((b) => [b.id, b]));

  const filtered = rows.filter((r) => {
    if (behavior !== ALL && r.behavior_id !== behavior) return false;
    if (value !== ALL) {
      const b = byId[r.behavior_id];
      if (!b || !b.values.some((v) => v.name === value)) return false;
    }
    return true;
  });

  return { value, setValue, behavior, setBehavior, filtered };
}

/* ----------------------------------------------------------------- stories */

export function Stories({ ctx }) {
  const { org, openBehavior, openRecord, canEdit } = ctx;
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);
  const toast = useToast();
  const f = useFilter(ctx, rows);

  const load = () => listStories(org.id).then(setRows).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [org.id]);

  return (
    <section>
      <div className="sectionhead">
        <h2>Stories</h2>
        <span className="note">
          <button className="btn small" onClick={() => setModal({ kind: 'add' })}>Add a story</button>
        </span>
      </div>
      <Filters ctx={ctx} {...f} />

      <div className="feed">
        {f.filtered.map((s) => {
          const p = preview(s.body);
          const files = (s.story_attachments ?? []).length;
          return (
            <div key={s.id} className="post">
              <span className="who">{s.author_name}</span>
              <span className="when">{new Date(s.created_at).toLocaleDateString()}</span>
              <p>{p.text}</p>
              <div className="tagrow">
                <BehaviorTag behavior={s.behaviors} onClick={() => openBehavior(s.behaviors.id)} />
                {byIdExample(ctx, s.behavior_id) && <Tag type="warn">Example</Tag>}
                {p.more && <Tag type="live">More to read</Tag>}
                {files > 0 && <Tag type="system">Attachments ({files})</Tag>}
              </div>
              <div className="btnrow">
                <button className="btn ghost small" onClick={() => openRecord('story', s.id)}>Open</button>
                <button className="btn ghost small" onClick={() => setModal({ kind: 'share', story: s })}>Share by email</button>
                {canEdit && (
                  <button className="btn ghost small" onClick={async () => {
                    if (!window.confirm('Delete this story? It cannot be undone.')) return;
                    try { await deleteStory(s.id); toast('Story deleted.'); load(); } catch (e) { toast(e.message); }
                  }}>Delete</button>
                )}
              </div>
            </div>
          );
        })}
        {!f.filtered.length && <div className="empty">No stories match that filter.</div>}
      </div>

      {modal?.kind === 'add' && (
        <PostForm ctx={ctx} kind="story" onClose={() => setModal(null)} toast={toast}
          onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.kind === 'share' && (
        <ShareStory story={modal.story} orgId={org.id} onClose={() => setModal(null)} toast={toast} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------- recognition */

function Recognition({ ctx }) {
  const { org, openBehavior, openRecord, canEdit } = ctx;
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const f = useFilter(ctx, rows);

  const load = () => listRecognitions(org.id).then(setRows).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [org.id]);

  return (
    <section>
      <div className="sectionhead">
        <h2>Recognition</h2>
        <span className="note">
          <button className="btn small" onClick={() => setAdding(true)}>Recognize someone</button>
        </span>
      </div>
      <Filters ctx={ctx} {...f} />

      <div className="feed">
        {f.filtered.map((r) => {
          const p = preview(r.body);
          const files = (r.attachments ?? []).length;
          return (
            <div key={r.id} className="post">
              <span className="who">{r.author_name} recognized {r.recipient}</span>
              <span className="when">{new Date(r.created_at).toLocaleDateString()}</span>
              <p>{p.text}</p>
              <div className="tagrow">
                <BehaviorTag behavior={r.behaviors} onClick={() => openBehavior(r.behaviors.id)} />
                {byIdExample(ctx, r.behavior_id) && <Tag type="warn">Example</Tag>}
                {p.more && <Tag type="live">More to read</Tag>}
                {files > 0 && <Tag type="system">Attachments ({files})</Tag>}
              </div>
              <div className="btnrow">
                <button className="btn ghost small" onClick={() => openRecord('recognition', r.id)}>Open</button>
                {canEdit && (
                  <button className="btn ghost small" onClick={async () => {
                    if (!window.confirm('Delete this recognition? It cannot be undone.')) return;
                    try { await deleteRecognition(r.id); toast('Recognition deleted.'); load(); } catch (e) { toast(e.message); }
                  }}>Delete</button>
                )}
              </div>
            </div>
          );
        })}
        {!f.filtered.length && <div className="empty">No recognition matches that filter.</div>}
      </div>

      {adding && (
        <PostForm ctx={ctx} kind="recognition" onClose={() => setAdding(false)} toast={toast}
          onDone={() => { setAdding(false); load(); }} />
      )}
    </section>
  );
}

/* One form for both, since they differ only by the recipient field. */
function PostForm({ ctx, kind, onClose, onDone, toast }) {
  const { org, behaviors } = ctx;
  const [f, setF] = useState({ behaviorId: behaviors[0]?.id, recipient: '', body: '', files: [] });
  const [busy, setBusy] = useState(false);
  const isRecognition = kind === 'recognition';

  async function save() {
    if (!f.body.trim()) return toast('Describe what happened first.');
    if (isRecognition && !f.recipient.trim()) return toast('Name the person you are recognizing.');
    setBusy(true);
    try {
      if (isRecognition) {
        await createRecognition(org.id, {
          behaviorId: f.behaviorId, recipient: f.recipient.trim(), body: f.body.trim(),
          authorName: org.displayName, files: f.files
        });
        toast('Recognition posted.');
      } else {
        await createStory(org.id, {
          behaviorId: f.behaviorId, body: f.body.trim(), authorName: org.displayName, files: f.files
        });
        toast('Story added.');
      }
      onDone();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={isRecognition ? 'Recognize someone' : 'Add a story'} onClose={onClose} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : isRecognition ? 'Post recognition' : 'Add the story'}</button>
      </>}>
      {isRecognition && (
        <>
          <label className="fl">Who are you recognizing?</label>
          <input type="text" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} />
        </>
      )}
      <label className="fl">Which behavior?</label>
      <select className="field" value={f.behaviorId} onChange={(e) => setF({ ...f, behaviorId: e.target.value })}>
        {behaviors.map((b) => (
          <option key={b.id} value={b.id}>
            {pad(b.number)}. {b.title}{b.is_example ? ' (example)' : ''}
          </option>
        ))}
      </select>
      <label className="fl">{isRecognition ? 'What did they do, and what did it change?' : 'What happened, and who did it?'}</label>
      <textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <label className="fl">Photo, video or file, optional</label>
      <input type="file" multiple accept="image/*,video/*,.pdf,.docx"
        onChange={(e) => setF({ ...f, files: Array.from(e.target.files) })} />
      {f.files.length > 0 && (
        <div className="tagrow" style={{ marginTop: 8 }}>
          {f.files.map((x) => <span key={x.name} className="tag">{x.name}</span>)}
        </div>
      )}
    </Modal>
  );
}

function ShareStory({ story, orgId, onClose, toast }) {
  const [to, setTo] = useState('');

  // Prefilled with everyone in the organization; trim the list before sending.
  useEffect(() => {
    listMemberEmails(orgId).then((emails) => setTo(emails.join(', '))).catch(() => {});
  }, [orgId]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const recipients = to.split(/[,;\s]+/).filter(Boolean);
    if (!recipients.length) return toast('Add at least one email address.');
    setBusy(true);
    try {
      const res = await shareStoryByEmail(story.id, recipients, note.trim() || null);
      toast(`Story sent to ${res.sent} recipient${res.sent === 1 ? '' : 's'}.`);
      onClose();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Share this story" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send story'}</button>
      </>}>
      {story.behaviors && <div className="tagrow"><BehaviorTag behavior={story.behaviors} /></div>}
      <p className="quiet">{story.body}</p>
      <label className="fl">Send to</label>
      <textarea rows={2} placeholder="Separate addresses with commas" value={to}
        onChange={(e) => setTo(e.target.value)} />
      <p className="meta">Prefilled with everyone in the organization. Remove anyone who should not get it.</p>
      <label className="fl">Add a note, optional</label>
      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="meta" style={{ marginTop: 12 }}>
        The email carries the behavior, the story and links to any attachments.
      </p>
    </Modal>
  );
}
