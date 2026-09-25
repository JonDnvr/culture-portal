import React, { useState } from 'react';
import { uploadMyAvatar, removeMyAvatar } from '../lib/api.js';
import { Modal, Avatar, useToast, confirmAction } from '../components/ui.jsx';

/**
 * Crops the middle square of a photo and shrinks it to 256 pixels, so a phone
 * picture becomes a few kilobytes before it leaves the browser.
 */
async function toSquare(file, px = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be read as a picture.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    canvas.getContext('2d').drawImage(img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfileDialog({ ctx, onClose }) {
  const { org, me, teams, reload } = ctx;
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const team = teams.find((t) => t.id === me?.team_id);

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Choose a picture: JPG, PNG or HEIC.');
    try {
      const sq = await toSquare(f);
      setFile(sq);
      setPreview(URL.createObjectURL(sq));
    } catch (err) { toast(err.message); }
  }

  async function save() {
    if (!file) return onClose();
    setBusy(true);
    try {
      await uploadMyAvatar(org.id, file);
      toast('Picture saved.');
      await reload();
      onClose();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirmAction({ title: 'Remove your picture?', body: 'Your initials show in its place.', action: 'Remove' }))) return;
    setBusy(true);
    try { await removeMyAvatar(org.id); toast('Picture removed.'); await reload(); onClose(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  const shown = preview ? { ...me, avatar_url: preview } : me;

  return (
    <Modal title="Your picture" onClose={onClose}
      footer={<>
        {me?.avatar_url && !preview && (
          <button className="btn ghost" onClick={remove} disabled={busy}>Remove picture</button>
        )}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy || !file}>{busy ? 'Saving…' : 'Save picture'}</button>
      </>}>
      <div className="profilehead">
        <Avatar person={shown} name={org.displayName} size={84} />
        <div>
          <div className="profilename">{me?.display_name ?? org.displayName}</div>
          <div className="meta">{team ? `${team.name} team` : 'No team yet'}</div>
        </div>
      </div>
      <p className="meta">
        It shows as a small circle next to what you record, share and receive. Any picture works;
        it is cropped to a square from the middle.
      </p>
      <label className="fl" htmlFor="avatarFile">Choose a picture</label>
      <input id="avatarFile" type="file" accept="image/*" onChange={pick} />
    </Modal>
  );
}
