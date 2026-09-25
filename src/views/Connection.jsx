import React, { useEffect, useState } from 'react';
import {
  createStory, createRecognition, shareStoryByEmail, shareRecognitionByEmail, shareAwardByEmail,
  updateStory, updateRecognition, listMemberEmails
} from '../lib/api.js';
import { RecordActions, FormButtons, FileEditor, formMode } from '../components/records.jsx';
import { DraftsPanel, RecordEditor } from './RecordEditor.jsx';
import { pad, Tag, BehaviorTag, Modal, Avatar, findPerson, useToast } from '../components/ui.jsx';
import { GoldStar } from '../components/badges.jsx';
import { Attachments } from './Details.jsx';
import { useListTools, ListBar, MoreButton, searchable, behaviorWords } from '../components/listTools.jsx';

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
      <div className="dateline">{ctx.term.Many} named out loud, and the record of them happening</div>
      <h1 className="pagetitle">Connection</h1>
      <p className="lede">Recognition tells people which {ctx.term.many} matter. Stories are how {ctx.term.many} become beliefs.</p>
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
        <span className="fl2">{ctx.term.One}</span>
        <select className="field inline" value={behavior} onChange={(e) => setBehavior(e.target.value)}>
          <option value={ALL}>All {ctx.term.many}</option>
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

const teamOfPerson = (ctx, id, name) => findPerson(ctx.people, { id, name })?.team_id ?? null;

export function Stories({ ctx }) {
  const { openBehavior, openRecord, activity, term } = ctx;
  const [modal, setModal] = useState(null);
  const toast = useToast();
  const f = useFilter(ctx, activity.stories);
  const tools = useListTools({
    ctx, rows: f.filtered,
    onTeam: (s, teamId) => teamOfPerson(ctx, s.author_id, s.author_name) === teamId,
    text: (s) => searchable(ctx, [s.author_name, s.body, new Date(s.created_at).toLocaleDateString(),
      behaviorWords(ctx.behaviors.find((b) => b.id === s.behavior_id))])
  });

  return (
    <section>
      <div className="sectionhead">
        <h2>Stories</h2>
        <span className="note">
          <button className="btn small" onClick={() => setModal({ kind: 'add' })}>Add a story</button>
        </span>
      </div>
      <DraftsPanel ctx={ctx} kind="story" title="Your draft stories" />
      <Filters ctx={ctx} {...f} />
      <ListBar ctx={ctx} tools={tools} placeholder={`Search stories: a name, a word, a ${term.one}`} />

      <div className="feed">
        {tools.shown.map((s) => {
          const p = preview(s.body);
          return (
            <div key={s.id} className="post">
              <span className="who who2">
                <Avatar person={findPerson(ctx.people, { id: s.author_id, name: s.author_name })} name={s.author_name} size={22} />
                {s.author_name}
              </span>
              <span className="when">{new Date(s.created_at).toLocaleDateString()}</span>
              <p>{p.text}</p>
              <Attachments files={s.story_attachments ?? []} compact />
              <div className="tagrow">
                <BehaviorTag behavior={s.behaviors} onClick={() => openBehavior(s.behaviors.id)} />
                {byIdExample(ctx, s.behavior_id) && <Tag type="warn">Example</Tag>}
                {p.more && <Tag type="live">More to read</Tag>}
              </div>
              <div className="btnrow">
                <button className="btn ghost small" onClick={() => openRecord('story', s.id)}>Open</button>
                <button className="btn ghost small" onClick={() => setModal({ kind: 'share', story: s })}>Share by email</button>
                <RecordActions ctx={ctx} kind="story" row={s} toast={toast} onEdit={(row) => setModal({ kind: 'edit', row })} />
              </div>
            </div>
          );
        })}
        {!tools.shown.length && <div className="empty">No stories match.</div>}
      </div>
      <MoreButton tools={tools} />

      {modal?.kind === 'add' && (
        <PostForm ctx={ctx} kind="story" onClose={() => setModal(null)} toast={toast}
          onDone={() => setModal(null)} />
      )}
      {modal?.kind === 'edit' && (
        <RecordEditor ctx={ctx} kind="story" row={modal.row} toast={toast}
          onClose={() => setModal(null)} onDone={() => setModal(null)} />
      )}
      {modal?.kind === 'share' && (
        <ShareStory story={modal.story} orgId={ctx.org.id} ctx={ctx} onClose={() => setModal(null)} toast={toast} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------- recognition */

function Recognition({ ctx }) {
  const { openBehavior, openRecord, activity, term } = ctx;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const toast = useToast();
  const f = useFilter(ctx, activity.recognitions);
  const tools = useListTools({
    ctx, rows: f.filtered,
    onTeam: (r, teamId) => teamOfPerson(ctx, r.author_id, r.author_name) === teamId
      || teamOfPerson(ctx, r.recipient_user_id, r.recipient) === teamId,
    text: (r) => searchable(ctx, [r.author_name, r.recipient, r.title, r.body,
      new Date(r.created_at).toLocaleDateString(), behaviorWords(ctx.behaviors.find((b) => b.id === r.behavior_id))])
  });

  return (
    <section>
      <div className="sectionhead">
        <h2>Recognition</h2>
        <span className="note">
          <button className="btn small" onClick={() => setAdding(true)}>Recognize someone</button>
        </span>
      </div>
      <DraftsPanel ctx={ctx} kind="recognition" title="Your draft recognition" />
      <Filters ctx={ctx} {...f} />
      <ListBar ctx={ctx} tools={tools} placeholder={`Search recognition: a name, a title, a ${term.one}`} />

      <div className="feed">
        {tools.shown.map((r) => {
          const p = preview(r.body);
          return (
            <div key={r.id} className="post">
              <span className="who who2">
                <Avatar person={findPerson(ctx.people, { id: r.author_id, name: r.author_name })} name={r.author_name} size={22} />
                {r.author_name} recognized
                <Avatar person={findPerson(ctx.people, { id: r.recipient_user_id, name: r.recipient })} name={r.recipient} size={22} />
                {r.recipient}
              </span>
              <span className="when">{new Date(r.created_at).toLocaleDateString()}</span>
              {r.title && (
                <p className="rectitle">{r.recipient_user_id && <GoldStar size={16} />} {r.title}</p>
              )}
              <p>{p.text}</p>
              <Attachments files={r.attachments ?? []} compact />
              <div className="tagrow">
                <BehaviorTag behavior={r.behaviors} onClick={() => openBehavior(r.behaviors.id)} />
                {byIdExample(ctx, r.behavior_id) && <Tag type="warn">Example</Tag>}
                {p.more && <Tag type="live">More to read</Tag>}
              </div>
              <div className="btnrow">
                <button className="btn ghost small" onClick={() => openRecord('recognition', r.id)}>Open</button>
                <button className="btn ghost small" onClick={() => setSharing(r)}>Share by email</button>
                <RecordActions ctx={ctx} kind="recognition" row={r} toast={toast} onEdit={setEditing} />
              </div>
            </div>
          );
        })}
        {!tools.shown.length && <div className="empty">No recognition matches.</div>}
      </div>
      <MoreButton tools={tools} />

      {adding && (
        <PostForm ctx={ctx} kind="recognition" onClose={() => setAdding(false)} toast={toast}
          onDone={() => setAdding(false)} />
      )}
      {editing && (
        <RecordEditor ctx={ctx} kind="recognition" row={editing} toast={toast}
          onClose={() => setEditing(null)} onDone={() => setEditing(null)} />
      )}
      {sharing && (
        <ShareRecord kind="recognition" id={sharing.id} onClose={() => setSharing(null)} toast={toast}
          summary={<>
            <p className="rectitle">{sharing.recipient_user_id && <GoldStar size={16} />} {sharing.title || sharing.recipient}</p>
            <p className="quiet">{sharing.author_name} recognized {sharing.recipient}. {preview(sharing.body).text}</p>
          </>} />
      )}
    </section>
  );
}

/*
 * One form for both, since they differ only by the recipient field. With
 * `initial` it edits that record; a draft can be saved again or published.
 */
export function PostForm({ ctx, kind, initial = null, onClose, onDone, toast }) {
  const { org, behaviors, people, teams, userId, term } = ctx;
  const isRecognition = kind === 'recognition';
  const mode = formMode(initial);
  // Recognition starts with no behavior chosen, so nobody posts to the
  // first one on the list by accident.
  const [f, setF] = useState(() => initial
    ? { behaviorId: initial.behavior_id ?? '', recipientId: initial.recipient_user_id ?? '', title: initial.title ?? '', body: initial.body ?? '', files: [] }
    : { behaviorId: isRecognition ? '' : behaviors[0]?.id, recipientId: '', title: '', body: '', files: [] });
  const [removeIds, setRemoveIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const existing = initial ? (initial.story_attachments ?? initial.attachments ?? []) : [];
  // Anyone in the organization except whoever wrote it. The gold star lands on their wall.
  const author = initial?.author_id ?? userId;
  const candidates = (people ?? [])
    .filter((p) => p.in_org !== false && p.user_id !== author)
    .slice().sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''));
  const teamName = (id) => teams.find((t) => t.id === id)?.name;
  // Older recognition named someone by typing; editing it keeps that name
  // unless a person is chosen.
  const typedOnly = !!initial && isRecognition && !initial.recipient_user_id;

  async function save(asDraft) {
    if (isRecognition && !f.recipientId && !typedOnly) return toast('Choose the person you are recognizing.');
    if (isRecognition && !f.title.trim()) return toast('Give it a title: a short line saying what they did.');
    if (!f.behaviorId) return toast(`Choose the ${term.one} this was.`);
    if (!f.body.trim()) return toast('Describe what happened first.');
    setBusy(true);
    const isDraft = mode === 'published' ? undefined : asDraft;
    try {
      const who = candidates.find((p) => p.user_id === f.recipientId);
      if (initial && isRecognition) {
        await updateRecognition(initial.id, {
          behaviorId: f.behaviorId, title: f.title.trim(), body: f.body.trim(), isDraft,
          ...(f.recipientId ? { recipientUserId: f.recipientId, recipient: who?.display_name ?? initial.recipient } : {}),
          addFiles: f.files, removeFileIds: removeIds
        });
      } else if (initial) {
        await updateStory(initial.id, {
          behaviorId: f.behaviorId, body: f.body.trim(), isDraft, addFiles: f.files, removeFileIds: removeIds
        });
      } else if (isRecognition) {
        await createRecognition(org.id, {
          behaviorId: f.behaviorId, recipientUserId: f.recipientId, recipient: who?.display_name ?? '',
          title: f.title.trim(), body: f.body.trim(), authorName: org.displayName, files: f.files, isDraft: asDraft
        });
      } else {
        await createStory(org.id, {
          behaviorId: f.behaviorId, body: f.body.trim(), authorName: org.displayName, files: f.files, isDraft: asDraft
        });
      }
      const noun = isRecognition ? 'Recognition' : 'Story';
      toast(mode === 'published' ? 'Changes saved.'
        : asDraft ? 'Saved as a draft. Only you can see it until you publish.'
          : isRecognition ? 'Recognition posted.' : mode === 'draft' ? `${noun} published.` : 'Story added.');
      await ctx.refreshActivity();
      onDone();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  const title = initial
    ? (isRecognition ? (mode === 'draft' ? 'Draft recognition' : 'Edit recognition') : (mode === 'draft' ? 'Draft story' : 'Edit story'))
    : (isRecognition ? 'Recognize someone' : 'Add a story');

  return (
    <Modal title={title} onClose={onClose} wide
      footer={<FormButtons mode={mode} busy={busy} onCancel={onClose} onSave={save}
        publishLabel={isRecognition ? 'Post recognition' : 'Add the story'} />}>
      {initial && initial.author_id !== userId && (
        <p className="notice">You are editing {initial.author_name}'s {isRecognition ? 'recognition' : 'story'}.</p>
      )}
      {isRecognition && (
        <>
          <label className="fl">Who are you recognizing?</label>
          <select className="field" value={f.recipientId} onChange={(e) => setF({ ...f, recipientId: e.target.value })}>
            <option value="">{typedOnly ? `${initial.recipient} (as typed)` : 'Choose a person'}</option>
            {candidates.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}{teamName(p.team_id) ? ` (${teamName(p.team_id)})` : ''}
              </option>
            ))}
          </select>
          {f.recipientId && (
            <div className="who2 pickedwho">
              <Avatar person={candidates.find((p) => p.user_id === f.recipientId)} size={28} />
              <span className="meta">A gold star goes on their Awards page{mode === 'new' ? '' : ' once it is published'}.</span>
            </div>
          )}
          <label className="fl">Title, a short line for the gold star</label>
          <input type="text" maxLength={90} placeholder="Held the Thursday deadline when the server went down"
            value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </>
      )}
      <label className="fl">Which {term.one}?</label>
      <select className="field" value={f.behaviorId} onChange={(e) => setF({ ...f, behaviorId: e.target.value })}>
        {isRecognition && <option value="">Choose a {term.one}</option>}
        {behaviors.map((b) => (
          <option key={b.id} value={b.id}>
            {pad(b.number)}. {b.title}{b.is_example ? ' (example)' : ''}
          </option>
        ))}
      </select>
      <label className="fl">{isRecognition ? 'What did they do, and what did it change?' : 'What happened, and who did it?'}</label>
      <textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <FileEditor id={isRecognition ? 'recFiles' : 'storyFiles'} existing={existing} removeIds={removeIds}
        setRemoveIds={setRemoveIds} files={f.files} setFiles={(files) => setF({ ...f, files })} />
      {mode === 'new' && <p className="meta" style={{ marginTop: 10 }}>Save as draft to finish it later. Only you see a draft.</p>}
    </Modal>
  );
}

function ShareStory({ story, orgId, ctx, onClose, toast }) {
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
        The email carries the {ctx?.term?.one ?? 'behavior'}, the story and links to any attachments.
      </p>
    </Modal>
  );
}

/**
 * Emails a recognition or a Value award, formatted, with its files. Unlike a
 * story, the address line starts empty: this usually goes to one person.
 */
export function ShareRecord({ kind, id, summary, onClose, toast }) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = kind === 'award' ? 'award' : 'recognition';

  async function send() {
    const recipients = to.split(/[,;\s]+/).filter(Boolean);
    if (!recipients.length) return toast('Add at least one email address.');
    setBusy(true);
    try {
      const res = kind === 'award'
        ? await shareAwardByEmail(id, recipients, note.trim() || null)
        : await shareRecognitionByEmail(id, recipients, note.trim() || null);
      toast(res?.mode === 'mailto'
        ? 'Your email program opened with it written out.'
        : `Sent to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}.`);
      onClose();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Share this ${noun}`} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={send} disabled={busy}>{busy ? 'Sending…' : `Send ${noun}`}</button>
      </>}>
      {summary}
      <label className="fl" htmlFor="shareTo">Send to</label>
      <textarea id="shareTo" rows={2} placeholder="Email addresses, separated by commas" value={to}
        onChange={(e) => setTo(e.target.value)} />
      <label className="fl" htmlFor="shareNote">Add a note, optional</label>
      <textarea id="shareNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="meta" style={{ marginTop: 12 }}>
        The email carries everything on the record: who, what, the {noun === 'award' ? 'Values and citation' : 'title and what happened'},
        with pictures shown in the email and links to any other files.
      </p>
    </Modal>
  );
}

