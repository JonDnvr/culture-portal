// supabase/functions/manage-users/index.ts
// Creates and manages accounts. Account creation needs the service role key,
// which must never reach a browser, so it lives here. Every call re-checks the
// caller's own role with their own token before the service role does anything.
//
//   supabase functions deploy manage-users

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** The welcome note, sent whenever someone gains access. */
type Delivery = { sent: boolean; reason?: string };

/**
 * The welcome note, sent whenever someone gains access. Returns what happened
 * rather than failing silently, so the admin who added the person is told
 * when an email did not go out and why.
 */
async function sendWelcome(orgName: string, to: string, name: string, role: string, password?: string): Promise<Delivery> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { sent: false, reason: 'RESEND_API_KEY is not set in Supabase secrets' };
  const from = Deno.env.get('STORY_FROM_EMAIL');
  if (!from) return { sent: false, reason: 'STORY_FROM_EMAIL is not set in Supabase secrets' };
  const appUrl = Deno.env.get('PUBLIC_APP_URL') ?? '';
  const html = `
<div style="font-family:Georgia,serif;max-width:600px;line-height:1.55;color:#151A18">
  <h2 style="font-size:21px">${name}, welcome to the ${orgName} culture portal.</h2>
  <p>You have been added as a ${role}.</p>
  <p style="font-family:Arial,sans-serif;font-size:13px;color:#3E4A46">
    <strong>Signing in</strong><br>
    Email: ${to}<br>
    ${password
      ? `Starting password: ${password}<br>`
      : 'Use your existing password. If you do not have one, choose Forgot password on the sign-in page to set it.<br>'}
    ${appUrl ? `<a href="${appUrl}">Open the portal</a><br>` : ''}
    Change your password after the first sign-in.
  </p>
  <p><strong>What you will find</strong></p>
  <ul style="font-size:15px;color:#3E4A46">
    <li><strong>Culture home</strong>: the purpose, the values, and the behavior being practised this week.</li>
    <li><strong>Clarity</strong>: every behavior, with coaching tips, teaching points and discussion questions.</li>
    <li><strong>Cadence</strong>: the weekly practice session, the rotation, the rituals and the systems.</li>
    <li><strong>Connection</strong>: recognize someone by name, and add stories of the behaviors happening.</li>
  </ul>
  <p style="font-size:15px;color:#3E4A46">
    When you sign in you will be asked to rate a couple of behaviors. It takes about thirty
    seconds, and it is how the team sees where the culture is strong and where it is thin.
  </p>
  <p style="font-family:Arial,sans-serif;font-size:12px;color:#5F6C67">— ${orgName}</p>
</div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `Welcome to the ${orgName} culture portal`, html })
    });
    if (!res.ok) {
      // Resend explains itself, e.g. "The horizonlinegroup.com domain is not verified".
      let reason = `Resend refused it (${res.status})`;
      try { reason = (await res.json())?.message ?? reason; } catch { /* keep the status */ }
      return { sent: false, reason };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `Could not reach Resend: ${e instanceof Error ? e.message : e}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data: { user: caller } } = await asUser.auth.getUser();
    if (!caller) return json({ error: 'Not signed in' }, 401);

    const { data: superRow } = await admin
      .from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle();
    const isSuper = !!superRow;

    const { data: callerMembership } = await admin
      .from('memberships').select('org_id, role').eq('user_id', caller.id).maybeSingle();

    /** Champions manage their own organization; the super user manages any. */
    function assertCanManage(orgId: string) {
      if (isSuper) return;
      if (!callerMembership || callerMembership.org_id !== orgId)
        throw new Error('You can only manage your own organization');
      if (!['champion', 'owner'].includes(callerMembership.role))
        throw new Error('Only a culture champion can do that');
    }

    const body = await req.json();
    const { action } = body;

    if (action === 'create') {
      const { orgId, email, name, role, password } = body;
      const wantWelcome = body.sendWelcome !== false;   // defaults to yes
      assertCanManage(orgId);
      if (!isEmail(String(email ?? ''))) return json({ error: 'That email address does not look right' }, 400);
      if (!password || String(password).length < 8) return json({ error: 'Set a starting password of at least eight characters' }, 400);
      if (role === 'owner' && !isSuper) return json({ error: 'Only the super user can assign the owner role' }, 403);

      const clean = String(email).trim().toLowerCase();

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: clean,
        password,
        email_confirm: true,
        user_metadata: { display_name: name ?? clean.split('@')[0] }
      });
      if (createErr) return json({ error: createErr.message }, 400);

      // One membership per person; the unique constraint on user_id is the
      // backstop if two admins act at once.
      const { error: memErr } = await admin.from('memberships').insert({
        org_id: orgId, user_id: created.user.id, role: role ?? 'member',
        display_name: name ?? clean.split('@')[0], email: clean
      });
      if (memErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: memErr.message }, 400);
      }
      const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).single();
      const welcome = wantWelcome
        ? await sendWelcome(org?.name ?? 'the', clean, name ?? clean.split('@')[0], role ?? 'member', password)
        : { sent: false, reason: 'not requested' };
      return json({ id: created.user.id, email: clean, role, welcome });
    }

    if (action === 'approve-request') {
      const { requestId, role } = body;
      const { data: reqRow } = await admin
        .from('access_requests').select('*').eq('id', requestId).maybeSingle();
      if (!reqRow) return json({ error: 'No such request' }, 404);
      assertCanManage(reqRow.org_id);
      if (role === 'champion') return json({ error: 'Approve as an admin, then hand over the champion role' }, 400);

      // The account already exists, without a membership; approving gives it one.
      let userId = reqRow.user_id;
      if (!userId) {
        const { data: list } = await admin.auth.admin.listUsers();
        userId = list.users.find((u) => u.email?.toLowerCase() === reqRow.email)?.id ?? null;
      }
      if (!userId) return json({ error: 'That account no longer exists' }, 404);

      const { error: memErr } = await admin.from('memberships').insert({
        org_id: reqRow.org_id, user_id: userId, role: role ?? 'member',
        display_name: reqRow.name, email: reqRow.email
      });
      if (memErr) return json({ error: memErr.message }, 400);

      await admin.from('access_requests').update({ status: 'approved' }).eq('id', requestId);

      const { data: org } = await admin.from('organizations').select('name').eq('id', reqRow.org_id).single();
      const welcome = await sendWelcome(org?.name ?? 'the', reqRow.email, reqRow.name, role ?? 'member');
      return json({ ok: true, id: userId, welcome });
    }

    if (action === 'send-welcome') {
      const { userId } = body;
      const { data: target } = await admin
        .from('memberships').select('org_id, role, display_name, email').eq('user_id', userId).maybeSingle();
      if (!target) return json({ error: 'No such person' }, 404);
      assertCanManage(target.org_id);
      const { data: org } = await admin.from('organizations').select('name').eq('id', target.org_id).single();
      const welcome = await sendWelcome(org?.name ?? 'the', target.email, target.display_name, target.role);
      return json({ ok: true, welcome });
    }

    if (action === 'set-role') {
      const { userId, role } = body;
      const { data: target } = await admin.from('memberships').select('org_id, role').eq('user_id', userId).maybeSingle();
      if (!target) return json({ error: 'No such person' }, 404);
      assertCanManage(target.org_id);
      if (role === 'owner' && !isSuper) return json({ error: 'Only the super user can assign the owner role' }, 403);
      if (userId === caller.id && !isSuper) return json({ error: 'You cannot change your own role' }, 403);

      const { error } = await admin.from('memberships').update({ role }).eq('user_id', userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'reset-password') {
      const { userId, password } = body;
      const { data: target } = await admin.from('memberships').select('org_id').eq('user_id', userId).maybeSingle();
      if (!target) return json({ error: 'No such person' }, 404);
      assertCanManage(target.org_id);
      if (!password || String(password).length < 8) return json({ error: 'Use at least eight characters' }, 400);

      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'remove') {
      const { userId } = body;
      if (userId === caller.id) return json({ error: 'You cannot remove your own account' }, 403);
      const { data: target } = await admin.from('memberships').select('org_id').eq('user_id', userId).maybeSingle();
      if (!target) return json({ error: 'No such person' }, 404);
      assertCanManage(target.org_id);

      // Stories and recognition stay in the record; the account goes.
      await admin.from('memberships').delete().eq('user_id', userId);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
