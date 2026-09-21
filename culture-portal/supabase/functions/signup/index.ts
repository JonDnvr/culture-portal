// supabase/functions/signup/index.ts
// The two public entry points: standing up a new portal, and asking to join
// an existing one. Both need the service role, so neither can run in a
// browser, and both are deliberately narrow about what they will do.
//
//   supabase functions deploy signup --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

/** A little content so the first sign-in is not an empty screen. */
const EXAMPLE = {
  values: [
    { name: 'Trust', description: 'What is said here is safe here, and what is promised here happens.' },
    { name: 'Candor', description: 'Say the hard thing early, to the person who can act on it.' },
    { name: 'Care', description: 'Full attention, real regard, and a team that is good to be on.' }
  ],
  systems: ['Meetings', 'Onboarding', 'Recognition'],
  behaviors: [
    {
      number: 1, title: 'Honor commitments', category: 'Character',
      description: 'If you say you will do it, it gets done on the date you said. If the date moves, you say so before it passes.',
      quick_tip: 'Say the date out loud when you make the commitment.',
      coaching_tips: ['Ask for the date, not the intent.', 'Thank an early reset publicly.'],
      teaching_points: ['A commitment has three parts: what, who and when.', 'Resetting early is honoring it; going quiet is breaking it.'],
      questions: ['What commitment are you carrying that will slip?', 'Where do dates get assumed instead of stated?'],
      failure_state: 'The date passes and nobody mentions it.',
      hard_rule: 'Any date that will be missed is reset before it passes, in writing.',
      values: ['Trust']
    },
    {
      number: 2, title: 'Say the hard thing early', category: 'Character',
      description: 'Raise the problem while it is small, to the person who can do something about it.',
      quick_tip: 'If you are rehearsing it in the car, send the message today.',
      coaching_tips: ['Thank the person before you respond to the content.', 'Ask directly: what are you not telling me?'],
      teaching_points: ['Problems raised early are cheap.', 'Silence is a decision, and usually the expensive one.'],
      questions: ['What are you sitting on right now?', 'What would make it safer to speak up here?'],
      failure_state: 'It comes out in a resignation, or in a meeting where it is too late.',
      hard_rule: 'Anything raised in good faith is heard without consequence.',
      values: ['Candor', 'Trust']
    },
    {
      number: 3, title: 'Credit people out loud', category: 'Connection',
      description: 'Say specifically who did the work, in front of others, close to when it happened.',
      quick_tip: 'Name the person, the behavior and the effect.',
      coaching_tips: ['Open meetings with a credit rather than closing with one.', 'Make sure credit reaches the roles nobody sees.'],
      teaching_points: ['Recognition is information about what matters here.', 'People repeat what gets named.'],
      questions: ['Whose work went unnamed this month?', 'Which roles here get thanked least?'],
      failure_state: 'Good work disappears and the person who did it hears nothing.',
      hard_rule: 'Every weekly meeting names at least one person and what they did.',
      values: ['Care']
    }
  ],
  practiceRitual: {
    applies_to_all: true,
    name: 'Behavior of the week practice',
    cadence: 'Every Mtg , 3 minutes',
    owner: 'Whoever is leading the meeting',
    description: "The short session that puts the week's behavior in front of the team. It applies to every meeting for the week that has > 3 people.",
    practice: [
      '1. Read the behavior out loud.', '',
      "2. Ask the week's discussion question to a particular person.", '',
      '3. Say why it is on the list and the difference it makes.', '',
      '4. Who saw someone do this well?', '',
      '5. Someone names a place they will practice it this week.'
    ].join('\n')
  }
};

async function sendWelcome(orgName: string, to: string, name: string, role: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return;
  const appUrl = Deno.env.get('PUBLIC_APP_URL') ?? '';
  const body = `
<div style="font-family:Georgia,serif;max-width:600px;line-height:1.55;color:#151A18">
  <h2 style="font-size:21px">${name}, welcome to the ${orgName} culture portal.</h2>
  <p>You have been added as a ${role}.</p>
  <p style="font-family:Arial,sans-serif;font-size:13px;color:#3E4A46">
    <strong>Signing in</strong><br>
    Email: ${to}<br>
    ${appUrl ? `<a href="${appUrl}">Open the portal</a><br>` : ''}
    Change your password after the first sign-in.
  </p>
  <p><strong>What you will find</strong></p>
  <ul style="font-size:15px;color:#3E4A46">
    <li><strong>Culture home</strong>: the purpose, the values, and the behavior being practised this week.</li>
    <li><strong>Clarity</strong>: every behavior, with coaching tips, teaching points and discussion questions.</li>
    <li><strong>Cadence</strong>: the weekly practice session, the rotation, the rituals and the systems that carry them.</li>
    <li><strong>Connection</strong>: recognize someone by name, and add stories of the behaviors happening.</li>
  </ul>
  <p style="font-size:15px;color:#3E4A46">
    When you sign in you will be asked to rate a couple of behaviors. It takes about thirty
    seconds, and it is how the team sees where the culture is strong and where it is thin.
  </p>
  <p style="font-family:Arial,sans-serif;font-size:12px;color:#5F6C67">— ${orgName}</p>
</div>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('STORY_FROM_EMAIL') ?? 'culture@example.com',
      to: [to],
      subject: `Welcome to the ${orgName} culture portal`,
      html: body
    })
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json();
    const { action } = body;

    /* ---------------------------------------------- a brand new portal */
    if (action === 'create-portal') {
      const { orgName, subtitle, championName, championEmail, password } = body;
      const email = String(championEmail ?? '').trim().toLowerCase();

      if (!orgName?.trim()) return json({ error: 'Name the organization' }, 400);
      if (!championName?.trim()) return json({ error: 'Give the culture champion a name' }, 400);
      if (!isEmail(email)) return json({ error: 'That email address does not look right' }, 400);
      if (!password || String(password).length < 8) return json({ error: 'Choose a password of at least eight characters' }, 400);

      const { data: org, error: orgErr } = await admin.from('organizations').insert({
        slug: `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID().slice(0, 6)}`,
        name: orgName.trim(),
        subtitle: subtitle?.trim() ?? null,
        initials: orgName.trim().slice(0, 2).toUpperCase(),
        mission: 'Write the shared purpose with your team. This line is an example until you change it.',
        vision: 'Write the vision with your team. This line is an example until you change it.',
        creed: 'We name the behavior, practice it weekly, and build it into how we already run.',
        plan: 'free', has_example_content: true, weekly_set_at: new Date().toISOString()
      }).select().single();
      if (orgErr) return json({ error: orgErr.message }, 400);

      const { data: created, error: userErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { display_name: championName.trim() }
      });
      if (userErr) {
        await admin.from('organizations').delete().eq('id', org.id);
        return json({ error: userErr.message }, 400);
      }

      await admin.from('memberships').insert({
        org_id: org.id, user_id: created.user.id, role: 'champion',
        display_name: championName.trim(), email
      });

      // Example content, all flagged so the app can mark and later clear it.
      const { data: values } = await admin.from('values_').insert(
        EXAMPLE.values.map((v, i) => ({ org_id: org.id, ...v, position: i, is_example: true }))
      ).select();
      await admin.from('system_categories').insert(
        EXAMPLE.systems.map((name, i) => ({ org_id: org.id, name, position: i, is_example: true }))
      );
      await admin.from('rituals').insert({ org_id: org.id, ...EXAMPLE.practiceRitual });

      const valueId = Object.fromEntries((values ?? []).map((v) => [v.name, v.id]));
      for (const b of EXAMPLE.behaviors) {
        const { values: names, ...rest } = b;
        const { data: row } = await admin.from('behaviors')
          .insert({ org_id: org.id, ...rest, is_example: true }).select().single();
        if (row) {
          await admin.from('behavior_values').insert(
            names.map((n) => ({ behavior_id: row.id, value_id: valueId[n] })).filter((x) => x.value_id)
          );
          if (b.number === 1) {
            await admin.from('organizations').update({ weekly_behavior_id: row.id }).eq('id', org.id);
          }
        }
      }

      await sendWelcome(org.name, email, championName.trim(), 'culture champion');

      // Hand the browser a session so the champion lands inside their portal.
      const { data: session } = await admin.auth.signInWithPassword({ email, password });
      return json({ org, session: session?.session ?? null });
    }

    /* ------------------------------------------- asking to join one */
    if (action === 'request-access') {
      const { name, email, orgName, password, note } = body;
      const clean = String(email ?? '').trim().toLowerCase();
      if (!name?.trim()) return json({ error: 'Give your name' }, 400);
      if (!isEmail(clean)) return json({ error: 'That email address does not look right' }, 400);
      if (!password || String(password).length < 8) return json({ error: 'Choose a password of at least eight characters' }, 400);

      const { data: org } = await admin.from('organizations')
        .select('id, name').ilike('name', String(orgName ?? '').trim()).maybeSingle();
      if (!org) return json({ error: 'We could not find that organization. Check the name with your culture champion.' }, 404);

      const { data: waiting } = await admin.from('access_requests')
        .select('id').eq('email', clean).eq('status', 'pending').maybeSingle();
      if (waiting) return json({ error: 'You already have a request waiting.' }, 400);

      // The password is held by Stripe-free means: an auth user is created
      // without a membership, so it cannot sign in until a request is approved.
      const { data: created, error: userErr } = await admin.auth.admin.createUser({
        email: clean, password, email_confirm: true,
        user_metadata: { display_name: name.trim(), pending_org: org.id }
      });
      if (userErr && !userErr.message.includes('already registered')) {
        return json({ error: userErr.message }, 400);
      }

      const { error } = await admin.from('access_requests').insert({
        org_id: org.id, name: name.trim(), email: clean,
        user_id: created?.user?.id ?? null, note: note?.trim() ?? null, status: 'pending'
      });
      if (error) return json({ error: error.message }, 400);

      return json({ org: org.name });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
