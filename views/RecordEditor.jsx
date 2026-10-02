import React, { useState } from 'react';
import { Modal, useToast } from '../components/ui.jsx';
import { RecordActions, draftSummary, draftDate, NOUN } from '../components/records.jsx';
import { PostForm } from './Connection.jsx';
import { RecordIteration } from './Cadence.jsx';
import { GiveAward } from './TrophyWall.jsx';

/** The right edit form for any record, wherever it was opened from. */
export function RecordEditor({ ctx, kind, row, onClose, onDone, toast }) {
  if (kind === 'story' || kind === 'recognition') {
    return <PostForm ctx={ctx} kind={kind} initial={row} onClose={onClose} onDone={onDone} toast={toast} />;
  }
  if (kind === 'iteration') {
    const ritual = row.ritual_id ? (ctx.rituals.find((r) => r.id === row.ritual_id) ?? row.ritual) : null;
    const system = row.system_category_id
      ? (ctx.systems.find((s) => s.id === row.system_category_id) ?? row.system) : null;
    const placement = system
      ? ctx.behaviors.filter((b) => (row.behavior_ids ?? []).includes(b.id))
        .flatMap((b) => b.placements ?? []).find((p) => p.systemId === system.id) ?? null
      : null;
    return (
      <RecordIteration ctx={ctx} ritual={ritual} system={system} placement={placement} initial={row}
        onClose={onClose} onDone={onDone} toast={toast} />
    );
  }
  return <GiveAward ctx={ctx} initial={row} onClose={onClose} onDone={onDone} />;
}

const DRAFT_KEY = { story: 'stories', recognition: 'recognitions', iteration: 'iterations', award: 'grants' };

/** Your own drafts of one kind, above the list they will join once published. */
export function DraftsPanel({ ctx, kind, title }) {
  const rows = ctx.drafts?.[DRAFT_KEY[kind]] ?? [];
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  if (!rows.length) return null;
  return (
    <div className="draftspanel">
      <div className="sectionhead">
        <h2 className="small">{title} ({rows.length})</h2>
        <span className="note">Only you can see these until you publish</span>
      </div>
      <DraftRows ctx={ctx} kind={kind} rows={rows} toast={toast} onEdit={setEditing} />
      {editing && (
        <RecordEditor ctx={ctx} kind={kind} row={editing} toast={toast}
          onClose={() => setEditing(null)} onDone={() => setEditing(null)} />
      )}
    </div>
  );
}

function DraftRows({ ctx, kind, rows, toast, onEdit }) {
  return (
    <div className="rowlist flat">
      {rows.map((r) => (
        <div key={r.id} className="row draftrow">
          <div>
            <div className="t">{draftSummary(ctx, kind, r)}</div>
            <div className="s">Draft {NOUN[kind]} · {draftDate(kind, r)}</div>
          </div>
          <div className="rowactions">
            <RecordActions ctx={ctx} kind={kind} row={r} toast={toast} onEdit={onEdit} />
          </div>
        </div>
      ))}
    </div>
  );
}

export const draftCount = (ctx) =>
  Object.values(DRAFT_KEY).reduce((n, k) => n + (ctx.drafts?.[k]?.length ?? 0), 0);

/** Every draft you have, from the menu under your name. */
export function DraftsDialog({ ctx, onClose }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const groups = [
    ['recognition', 'Recognition'], ['story', 'Stories'], ['iteration', 'Sessions'], ['award', 'Value awards']
  ].map(([kind, label]) => ({ kind, label, rows: ctx.drafts?.[DRAFT_KEY[kind]] ?? [] })).filter((g) => g.rows.length);

  if (editing) {
    return (
      <RecordEditor ctx={ctx} kind={editing.kind} row={editing.row} toast={toast}
        onClose={() => setEditing(null)} onDone={() => setEditing(null)} />
    );
  }
  return (
    <Modal title="Your drafts" onClose={onClose} wide
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      {!groups.length && <div className="empty">No drafts. Anything you save as a draft waits here until you publish it.</div>}
      {groups.map((g) => (
        <div key={g.kind} className="draftgroup">
          <h4 className="fl">{g.label}</h4>
          <DraftRows ctx={ctx} kind={g.kind} rows={g.rows} toast={toast}
            onEdit={(row) => setEditing({ kind: g.kind, row })} />
        </div>
      ))}
    </Modal>
  );
}
