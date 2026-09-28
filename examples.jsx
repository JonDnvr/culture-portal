import React, { useState } from 'react';
import { clearExampleContent } from '../lib/api.js';
import { useToast, confirmAction } from './ui.jsx';

/**
 * Deletes everything still marked as an example, after asking. Used on the
 * home page's example note and in Admin, About Us; editors only.
 */
export function ClearExamplesButton({ ctx, className = 'btn small' }) {
  const { org, term, refreshOrgs, reload } = ctx;
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function clear() {
    const ok = await confirmAction({
      title: 'Delete everything still marked as an example?',
      body: `Example values, ${term.many}, systems, rituals, sessions, recognition, stories and awards go. ` +
        'Anything you have edited is yours and stays. This cannot be undone.',
      action: 'Clear example content'
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearExampleContent(org.id);
      toast('Example content cleared.');
      await refreshOrgs();
      reload();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <button className={className} onClick={clear} disabled={busy}>
      {busy ? 'Clearing…' : 'Clear example content'}
    </button>
  );
}
