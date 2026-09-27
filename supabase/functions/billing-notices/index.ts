// supabase/functions/billing-notices/index.ts
// Runs once a day. For every organization it works out which notices are
// due (trial ending, trial ended, renewal coming, cancellation ending,
// payment overdue, access narrowed) with the same rules the portal shows,
// emails the culture champion with a copy to Horizon Line, and records each
// one so it goes out once.
//
//   supabase functions deploy billing-notices --no-verify-jwt
//   supabase secrets set CRON_SECRET=<any long random string>
//   Then schedule it daily (DEPLOY-R4.md, step 5).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { noticesDue, noticeEmail, isoDay } from '../_shared/billing.js';
import { sendBillingEmail, championEmail } from '../_shared/email.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('Forbidden', { status: 403 });

  // Mountain time decides what "today" is for everyone.
  const today = isoDay(Date.now() - 6 * 3600 * 1000);
  const { data: orgs, error } = await admin.from('organizations').select('*');
  if (error) return new Response(error.message, { status: 500 });

  const sent: string[] = [];
  for (const org of orgs ?? []) {
    for (const n of noticesDue(org, today)) {
      const { data: already } = await admin.from('billing_notices').select('id')
        .eq('org_id', org.id).eq('notice_key', n.key).maybeSingle();
      if (already) continue;
      const to = await championEmail(admin, org.id);
      const m = noticeEmail(n.kind, org, today);
      try {
        if (to) await sendBillingEmail([to], m.subject, m.body);
        await admin.from('billing_notices').insert({ org_id: org.id, notice_key: n.key, kind: n.kind, sent_to: to });
        await admin.from('billing_events').insert({ org_id: org.id, kind: 'notice', detail: { kind: n.kind, subject: m.subject } });
        sent.push(`${org.name}: ${n.kind}`);
      } catch (e) {
        console.error(org.name, n.kind, e);
      }
    }
  }
  return new Response(JSON.stringify({ today, sent }), { headers: { 'Content-Type': 'application/json' } });
});
