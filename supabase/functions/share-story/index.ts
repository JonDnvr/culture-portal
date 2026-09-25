// supabase/functions/share-story/index.ts
// Sends a story, a recognition or a Value award by email, formatted, with the
// behavior it belongs to and signed links to its attachments. Pictures show
// in the email itself.
//
//   supabase functions deploy share-story
//   supabase secrets set RESEND_API_KEY=... STORY_FROM_EMAIL=... PUBLIC_APP_URL=...
//
// Body: { kind: 'story' | 'recognition' | 'award', id, recipients, note }
// The older { storyId, recipients, note } still works, so nothing breaks while
// the site and the function are updated a minute apart.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM = Deno.env.get('STORY_FROM_EMAIL') ?? 'culture@example.com';
const APP_URL = Deno.env.get('PUBLIC_APP_URL') ?? '';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function isEmail(s: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

type Attachment = { file_name: string; storage_path: string; kind: string };
type Link = { name: string; url: string; kind: string };

// deno-lint-ignore no-explicit-any
async function sign(client: any, files: Attachment[] = []): Promise<Link[]> {
  const out: Link[] = [];
  for (const a of files) {
    const { data } = await client.storage.from('story-media').createSignedUrl(a.storage_path, SIGNED_URL_SECONDS);
    if (data?.signedUrl) out.push({ name: a.file_name, url: data.signedUrl, kind: a.kind });
  }
  return out;
}

/** One layout for every kind: header, the behavior, the record, the files. */
function layout(o: {
  accent: string; orgName: string; kicker: string; title: string; subtitle?: string;
  behavior?: { number: number; title: string; description: string } | null;
  values?: string[]; note?: string | null; body: string; byline: string; links: Link[];
}) {
  const pics = o.links.filter((l) => l.kind === 'image');
  const rest = o.links.filter((l) => l.kind !== 'image');
  return `
<div style="background:#EFF1EE;padding:24px 0">
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff;color:#151A18;line-height:1.55;border-top:4px solid ${esc(o.accent)}">
  <div style="padding:26px 30px 8px">
    <p style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${esc(o.accent)};margin:0 0 8px;font-weight:bold">
      ${esc(o.orgName)} &nbsp;/&nbsp; ${esc(o.kicker)}
    </p>
    <h1 style="font-size:25px;font-weight:normal;margin:0 0 4px">${esc(o.title)}</h1>
    ${o.subtitle ? `<p style="font-size:16px;color:#3E4A46;margin:0 0 6px">${esc(o.subtitle)}</p>` : ''}
    ${o.values?.length ? `<p style="font-family:Arial,sans-serif;font-size:12px;color:#B5541C;margin:6px 0 0">${o.values.map(esc).join(' &nbsp;·&nbsp; ')}</p>` : ''}
  </div>
  ${o.behavior ? `
  <div style="margin:14px 30px 0;padding:12px 16px;background:#F7F8F6;border-left:3px solid ${esc(o.accent)}">
    <p style="margin:0;font-size:16px"><b style="color:${esc(o.accent)}">${pad(o.behavior.number)}.</b> ${esc(o.behavior.title)}</p>
    <p style="margin:4px 0 0;font-size:14px;color:#3E4A46">${esc(o.behavior.description)}</p>
  </div>` : ''}
  <div style="padding:18px 30px 6px">
    ${o.note ? `<p style="font-size:15px;font-style:italic;color:#3E4A46;margin:0 0 14px">${esc(o.note)}</p>` : ''}
    <p style="font-size:17px;margin:0 0 12px;white-space:pre-wrap">${esc(o.body)}</p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#5F6C67;margin:0">${esc(o.byline)}</p>
  </div>
  ${pics.length ? `<div style="padding:12px 30px 0">${pics.map((l) =>
    `<a href="${l.url}"><img src="${l.url}" alt="${esc(l.name)}" style="max-width:100%;border-radius:4px;margin:0 0 10px;display:block"></a>`).join('')}</div>` : ''}
  ${rest.length ? `
  <div style="padding:6px 30px 0">
    <p style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5F6C67;margin:10px 0 6px">Attachments</p>
    <ul style="font-family:Arial,sans-serif;font-size:14px;padding-left:18px;margin:0">
      ${rest.map((l) => `<li style="margin-bottom:4px"><a href="${l.url}" style="color:#3F5951">${esc(l.name)}</a> <span style="color:#5F6C67">(${l.kind === 'video' ? 'video' : 'file'})</span></li>`).join('')}
    </ul>
    <p style="font-family:Arial,sans-serif;font-size:11px;color:#8B9A95;margin:6px 0 0">Links work for seven days.</p>
  </div>` : ''}
  <div style="padding:22px 30px 26px">
    ${APP_URL ? `<a href="${APP_URL}" style="font-family:Arial,sans-serif;font-size:13px;color:#fff;background:#3F5951;padding:9px 16px;border-radius:4px;text-decoration:none">Open the culture portal</a>` : ''}
  </div>
</div>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const payload = await req.json();
    const kind: string = payload.kind ?? 'story';
    const id: string = payload.id ?? payload.storyId;
    const note: string | null = payload.note ?? null;
    const to = (Array.isArray(payload.recipients) ? payload.recipients : String(payload.recipients ?? '').split(/[,;\s]+/))
      .map((r: string) => r.trim())
      .filter(isEmail);

    if (!id) return json({ error: 'Which record to send is missing' }, 400);
    if (!to.length) return json({ error: 'At least one valid email address is required' }, 400);
    if (to.length > 25) return json({ error: 'Twenty-five recipients maximum' }, 400);

    // The caller's own token, so row level security decides what they can read.
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    let subject = '';
    let html = '';

    if (kind === 'story') {
      const { data: s, error } = await asUser.from('stories').select(`
          id, body, author_name, created_at,
          behaviors ( number, title, description ),
          organizations ( name, accent ),
          story_attachments ( file_name, storage_path, kind )`)
        .eq('id', id).single();
      if (error || !s) return json({ error: 'Story not found' }, 404);
      const b = s.behaviors as { number: number; title: string; description: string };
      const org = s.organizations as { name: string; accent: string };
      subject = `${org.name}: a story about ${pad(b.number)}. ${b.title}`;
      html = layout({
        accent: org.accent || '#9C7A3C', orgName: org.name, kicker: 'A story',
        title: `${s.author_name} shared a story`, behavior: b, note, body: s.body,
        byline: fmtDate(s.created_at), links: await sign(asUser, s.story_attachments)
      });
      await asUser.from('story_shares').insert({ story_id: id, sent_by: user.id, recipients: to, note });
    } else if (kind === 'recognition') {
      const { data: r, error } = await asUser.from('recognitions').select(`
          id, body, title, recipient, author_name, created_at,
          behaviors ( number, title, description ),
          organizations ( name, accent ),
          recognition_attachments ( file_name, storage_path, kind )`)
        .eq('id', id).single();
      if (error || !r) return json({ error: 'Recognition not found' }, 404);
      const b = r.behaviors as { number: number; title: string; description: string };
      const org = r.organizations as { name: string; accent: string };
      subject = `${org.name}: ${r.author_name} recognized ${r.recipient}`;
      html = layout({
        accent: org.accent || '#9C7A3C', orgName: org.name, kicker: 'Recognition',
        title: r.recipient, subtitle: r.title ? `★ ${r.title}` : undefined, behavior: b, note, body: r.body,
        byline: `Recognized by ${r.author_name}, ${fmtDate(r.created_at)}`,
        links: await sign(asUser, r.recognition_attachments)
      });
    } else if (kind === 'award') {
      const { data: g, error } = await asUser.from('award_grants').select(`
          id, citation, recipient_name, granted_by_name, granted_at, team_id,
          award_types ( name, description, award_type_values ( values_ ( name ) ) ),
          organizations ( name, accent ),
          award_grant_attachments ( file_name, storage_path, kind )`)
        .eq('id', id).single();
      if (error || !g) return json({ error: 'Award not found' }, 404);
      // deno-lint-ignore no-explicit-any
      const t = g.award_types as any;
      const org = g.organizations as { name: string; accent: string };
      // deno-lint-ignore no-explicit-any
      const values = (t?.award_type_values ?? []).map((v: any) => v.values_?.name).filter(Boolean);
      subject = `${org.name}: ${t?.name ?? 'Value award'} for ${g.recipient_name}`;
      html = layout({
        accent: org.accent || '#9C7A3C', orgName: org.name, kicker: 'Value award',
        title: t?.name ?? 'Value award',
        subtitle: `Conferred on ${g.team_id ? `the ${g.recipient_name} team` : g.recipient_name}`,
        values, note, body: g.citation,
        byline: `Conferred by ${g.granted_by_name}, ${fmtDate(g.granted_at)}`,
        links: await sign(asUser, g.award_grant_attachments)
      });
    } else {
      return json({ error: `Unknown kind: ${kind}` }, 400);
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html })
    });
    if (!res.ok) return json({ error: 'Email provider rejected the send', detail: await res.text() }, 502);

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
