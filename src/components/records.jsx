import React from 'react';
import { confirmAction, Tag } from './ui.jsx';
import {
  deleteStory, deleteRecognition, deleteIteration, deleteAwardGrant,
  updateStory, updateRecognition, updateIteration, updateAwardGrant
} from '../lib/api.js';

/**
 * Edit, publish and delete for the four kinds of record people make: stories,
 * recognition, sessions (ritual and system runs) and Value awards.
 *
 * Who may: the person who made it, and the culture champion, admins and the
 * super admin for anything published. The database enforces the same rule;
 * these helpers only decide which buttons to show.
 */

export const NOUN = { story: 'story', recognition: 'recognition', iteration: 'session', award: 'Value award' };
const OWNER = {
  story: (r) => r.author_id,
  recognition: (r) => r.author_id,
  iteration: (r) => r.recorded_by,
  award: (r) => r.granted_by
};
const DELETE = { story: deleteStory, recognition: deleteRecognition, iteration: deleteIteration, award: deleteAwardGrant };
const UPDATE = { story: updateStory, recognition: updateRecognition, iteration: updateIteration, award: updateAwardGrant };

const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const ownerOf = (kind, row) => OWNER[kind](row);

export function canModify(ctx, kind, row) {
  if (!row) return false;
  return OWNER[kind](row) === ctx.userId || ctx.canEdit || ctx.isSuper;
}

/** Asks first, always. Resolves true when the record is gone. */
export async function removeRecord(ctx, kind, row, toast) {
  const noun = NOUN[kind];
  let body = 'Its files go with it. This cannot be undone.';
  if (!row.is_draft && kind === 'recognition' && row.recipient_user_id) {
    body = `The gold star comes off ${row.recipient}'s wall. This cannot be undone.`;
  }
  if (!row.is_draft && kind === 'award') {
    body = `It comes off ${row.recipient_name}'s wall${row.team_id ? ', and off every team member\'s' : ''}. This cannot be undone.`;
  }
  const ok = await confirmAction({ title: row.is_draft ? `Delete this draft ${noun}?` : `Delete this ${noun}?`, body });
  if (!ok) return false;
  try {
    await DELETE[kind](row.id);
    toast(`${upper(noun)} deleted.`);
    await ctx.refreshActivity();
    return true;
  } catch (e) { toast(e.message); return false; }
}

export async function publishRecord(ctx, kind, row, toast) {
  try {
    await UPDATE[kind](row.id, { isDraft: false });
    toast(`${upper(NOUN[kind])} published. Everyone can see it now.`);
    await ctx.refreshActivity();
    return true;
  } catch (e) { toast(e.message); return false; }
}

/** Edit, Publish (drafts only) and Delete, for whoever is allowed. */
export function RecordActions({ ctx, kind, row, toast, onEdit, onChanged, onDeleted }) {
  if (!canModify(ctx, kind, row)) return null;
  return (
    <>
      {onEdit && <button className="btn ghost small" onClick={() => onEdit(row)}>Edit</button>}
      {row.is_draft && (
        <button className="btn small" onClick={async () => {
          if (await publishRecord(ctx, kind, row, toast)) onChanged?.();
        }}>Publish</button>
      )}
      <button className="btn ghost small danger" onClick={async () => {
        if (await removeRecord(ctx, kind, row, toast)) onDeleted?.();
      }}>Delete</button>
    </>
  );
}

export function DraftTag() {
  return <Tag type="draft">Draft · only you see it</Tag>;
}

/**
 * The buttons at the foot of every create or edit form.
 * new:        Cancel · Save as draft · (publish label)
 * draft:      Cancel · Save draft · Publish
 * published:  Cancel · Save changes
 */
export function FormButtons({ mode, busy, onCancel, onSave, publishLabel }) {
  return (
    <>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
      {mode !== 'published' && (
        <button className="btn ghost" onClick={() => onSave(true)} disabled={busy}>
          {mode === 'draft' ? 'Save draft' : 'Save as draft'}
        </button>
      )}
      <button className="btn" onClick={() => onSave(false)} disabled={busy}>
        {busy ? 'Saving…' : mode === 'published' ? 'Save changes' : mode === 'draft' ? 'Publish' : publishLabel}
      </button>
    </>
  );
}

export const formMode = (initial) => (!initial ? 'new' : initial.is_draft ? 'draft' : 'published');

/** Files already on the record, each removable, and a picker for more. */
export function FileEditor({ id, existing = [], removeIds, setRemoveIds, files, setFiles, label = 'Photo, video or file, optional' }) {
  const toggle = (fid) => setRemoveIds(removeIds.includes(fid) ? removeIds.filter((x) => x !== fid) : [...removeIds, fid]);
  return (
    <>
      <label className="fl" htmlFor={id}>{label}</label>
      {existing.length > 0 && (
        <div className="fileedit">
          {existing.map((a) => (
            <span key={a.id} className={removeIds.includes(a.id) ? 'filechip gone' : 'filechip'}>
              <span className="fname">{a.file_name}</span>
              <button type="button" className="linkbtn2" onClick={() => toggle(a.id)}>
                {removeIds.includes(a.id) ? 'Keep' : 'Remove'}
              </button>
            </span>
          ))}
        </div>
      )}
      <input id={id} type="file" multiple accept="image/*,video/*,.pdf,.docx"
        onChange={(e) => setFiles(Array.from(e.target.files))} />
      {files.length > 0 && (
        <div className="tagrow" style={{ marginTop: 8 }}>
          {files.map((x) => <span key={x.name} className="tag">{x.name}</span>)}
        </div>
      )}
    </>
  );
}

/** What a draft is, in one line, for the drafts lists. */
export function draftSummary(ctx, kind, r) {
  if (kind === 'story') return (r.body ?? '').slice(0, 110) || 'Story';
  if (kind === 'recognition') return `To ${r.recipient || 'someone'}${r.title ? `: ${r.title}` : ''}`;
  if (kind === 'iteration') {
    const src = r.ritual?.name ?? r.system?.name ?? 'Session';
    const bs = (r.behaviors ?? []).map((b) => `${String(b.number).padStart(2, '0')}. ${b.title}`).join(', ');
    return bs ? `${src} · ${bs}` : src;
  }
  return `${r.award?.name ?? 'Value award'} for ${r.recipient_name}`;
}

export const draftDate = (kind, r) =>
  new Date(kind === 'iteration' ? r.held_at : kind === 'award' ? r.granted_at : r.created_at).toLocaleDateString();
