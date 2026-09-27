// Plain billing emails through Resend, the same provider the portal already
// uses for welcome and share emails. RESEND_API_KEY and STORY_FROM_EMAIL are
// already set as secrets; BILLING_COPY_TO is optional (defaults to Jon).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('STORY_FROM_EMAIL') ?? 'Culture Portal <jon@horizonlinegroup.com>';
export const COPY_TO = Deno.env.get('BILLING_COPY_TO') ?? 'jon@horizonlinegroup.com';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function sendBillingEmail(to: string[], subject: string, body: string) {
  if (!RESEND_API_KEY || !to.length) return { skipped: true };
  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#13262F;max-width:560px">` +
    body.split('\n\n').map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') + '</div>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, bcc: to.includes(COPY_TO) ? undefined : [COPY_TO], subject, text: body, html })
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
