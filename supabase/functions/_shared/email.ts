// Billing emails, with one action button, through Resend, the same provider the portal already
// uses for welcome and share emails. RESEND_API_KEY and STORY_FROM_EMAIL are
// already set as secrets; BILLING_COPY_TO is optional (defaults to Jon).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('STORY_FROM_EMAIL') ?? 'Culture Portal <jon@horizonlinegroup.com>';
export const COPY_TO = Deno.env.get('BILLING_COPY_TO') ?? 'jon@horizonlinegroup.com';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const APP_URL = (Deno.env.get('PUBLIC_APP_URL') ?? '').replace(/\/+$/, '');

/** A button for the step the email asks for: a full url, or a path in the portal. */
export type EmailAction = { label: string; url?: string; path?: string };

function actionButton(a?: EmailAction | null) {
  const href = a?.url ?? (a?.path && APP_URL ? `${APP_URL}/${a.path.replace(/^\//, '')}` : '');
  if (!a || !href) return { html: '', text: '' };
  return {
    html: `<p style="margin:22px 0 6px"><a href="${esc(href)}" style="font-family:Arial,sans-serif;font-size:14px;color:#fff;background:#3F5951;padding:10px 18px;border-radius:4px;text-decoration:none;display:inline-block">${esc(a.label)}</a></p>`,
    text: `\n\n${a.label}: ${href}`
  };
}

export async function sendBillingEmail(to: string[], subject: string, body: string, action?: EmailAction | null) {
  if (!RESEND_API_KEY || !to.length) return { skipped: true };
  // The button goes after the message, above the sign-off.
  const parts = body.split('\n\n');
  const signoff = parts.length > 1 && parts[parts.length - 1] === 'Horizon Line Group' ? parts.pop()! : null;
  const btn = actionButton(action);
  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#13262F;max-width:560px">` +
    parts.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') + btn.html +
    (signoff ? `<p>${esc(signoff)}</p>` : '') + '</div>';
  const text = parts.join('\n\n') + btn.text + (signoff ? `\n\n${signoff}` : '');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, bcc: to.includes(COPY_TO) ? undefined : [COPY_TO], subject, text, html })
  });
  if (!res.ok) throw new Error(`Resend refused the email: ${await res.text()}`);
  return { sent: true };
}

/** The culture champion's address for an organization. */
export async function championEmail(admin: any, orgId: string): Promise<string | null> {
  const { data } = await admin.from('memberships').select('email')
    .eq('org_id', orgId).eq('role', 'champion').maybeSingle();
  return data?.email ?? null;
}
