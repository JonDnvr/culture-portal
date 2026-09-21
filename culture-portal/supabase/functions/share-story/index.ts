// supabase/functions/share-story/index.ts
// Sends a story by email with signed links to its attachments.
//
//   supabase functions deploy share-story
//   supabase secrets set RESEND_API_KEY=... STORY_FROM_EMAIL=... PUBLIC_APP_URL=...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM = Deno.env.get('STORY_FROM_EMAIL') ?? 'culture@example.com';
const APP_URL = Deno.env.get('PUBLIC_APP_URL') ?? '';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function isEmail(s: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const { storyId, recipients, note } = await req.json();
    const to = (Array.isArray(recipients) ? recipients : String(recipients ?? '').split(/[,;\s]+/))
      .map((r: string) => r.trim())
      .filter(isEmail);

    if (!storyId) return json({ error: 'storyId is required' }, 400);
    if (!to.length) return json({ error: 'At least one valid email address is required' }, 400);
    if (to.length > 25) return json({ error: 'Twenty-five recipients maximum' }, 400);

    // Caller's own token, so row level security decides what they can read.
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    // If the caller is not a member of the story's organization, RLS returns nothing.
    const { data: story, error } = await asUser
      .from('stories')
      .select(`
        id, body, author_name, created_at, org_id,
        behaviors ( number, title, description ),
        organizations ( name ),
        story_attachments ( file_name, storage_path, kind )
      `)
      .eq('id', storyId)
      .single();

    if (error || !story) return json({ error: 'Story not found' }, 404);

    const links: { name: string; url: string; kind: string }[] = [];
    for (const a of story.story_attachments ?? []) {
      const { data: signed } = await asUser.storage
        .from('story-media')
        .createSignedUrl(a.storage_path, SIGNED_URL_SECONDS);
      if (signed?.signedUrl) links.push({ name: a.file_name, url: signed.signedUrl, kind: a.kind });
    }

    const behavior = story.behaviors as { number: number; title: string; description: string };
    const orgName = (story.organizations as { name: string }).name;
    const num = String(behavior.number).padStart(2, '0');

    const html = `
<div style="font-family:Georgia,serif;max-width:600px;color:#151A18;line-height:1.55">
  <p style="font-family:Arial,sans-serif;font-size:12px;color:#5F6C67;margin:0 0 6px">
    ${escapeHtml(orgName)} &nbsp;/&nbsp; ${escapeHtml(story.author_name)} shared a story
  </p>
  <h2 style="font-size:22px;margin:0 0 4px">${num}. ${escapeHtml(behavior.title)}</h2>
  <p style="font-size:15px;color:#3E4A46;margin:0 0 18px">${escapeHtml(behavior.description)}</p>
  ${note ? `<p style="font-size:16px;border-left:3px solid #9C7A3C;padding-left:14px">${escapeHtml(note)}</p>` : ''}
  <p style="font-size:17px">${escapeHtml(story.body)}</p>
  ${links.length ? `
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#5F6C67;margin:22px 0 6px">Attachments</p>
    <ul style="font-family:Arial,sans-serif;font-size:14px;padding-left:18px">
      ${links.map((l) => `<li><a href="${l.url}" style="color:#3F5951">${escapeHtml(l.name)}</a> (${l.kind}, link valid 7 days)</li>`).join('')}
    </ul>` : ''}
  ${APP_URL ? `<p style="font-family:Arial,sans-serif;font-size:13px;margin-top:24px">
    <a href="${APP_URL}" style="color:#3F5951">Open the culture portal</a></p>` : ''}
</div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: `${orgName}: ${num}. ${behavior.title}`,
        html
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: 'Email provider rejected the send', detail }, 502);
    }

    await asUser.from('story_shares').insert({
      story_id: storyId,
      sent_by: user.id,
      recipients: to,
      note: note ?? null
    });

    return json({ sent: to.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
