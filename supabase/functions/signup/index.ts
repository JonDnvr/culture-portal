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
    { name: 'Challenge', category: 'Change', description: 'Hold a high bar, and push each other to reach it.' },
    { name: 'Candor', category: 'Character', description: 'Say the hard thing early, to the person who can act on it.' },
    { name: 'Care', category: 'Connection', description: 'Full attention, real regard, and a team that is good to be on.' }
  ],
  systems: ['Meetings', 'Onboarding', 'Recognition'],
  // Where each example behavior is built into a system, by behavior number.
  placements: [
    { number: 1, system: 'Meetings', owner: 'Whoever leads the meeting', cadence: 'Every meeting',
      artifact: 'Commitments read back at the open',
      template: 'Open every meeting by reading last week\'s commitments aloud: who, what and the date. Anyone whose date will move says so now.' },
    { number: 2, system: 'Onboarding', owner: 'Hiring manager', cadence: 'First week',
      artifact: 'A first-week check-in',
      template: 'On day five, ask the new person: what have you noticed that nobody has said out loud yet?' },
    { number: 3, system: 'Recognition', owner: 'Team lead', cadence: 'Weekly',
      artifact: 'One named credit in the weekly note',
      template: 'Name the person, what they did, and the difference it made. One line is enough.' }
  ],
  // A ritual of its own, applied to one behavior, alongside the weekly practice.
  ritual: {
    name: 'Friday wins round', cadence: 'Fridays, 10 minutes', owner: 'Team lead',
    description: 'Ten minutes at the end of the week to name who did good work, and what it made possible.',
    practice: [
      '1. Each person names one teammate and one thing they did this week.', '',
      '2. Say the effect: what it made easier, faster or better.', '',
      '3. The lead writes the names down for the weekly note.'
    ].join('\n'),
    behaviors: [3]
  },
  // A little history, recorded by the culture champion, so Cadence, Connection
  // and the home page show what a working portal looks like.
  activity: {
    runs: [
      { ritual: 'practice', behavior: 1, daysAgo: 2,
        notes: 'Example. Read the behavior aloud; two people named a date that had slipped and reset it on the spot.' },
      { ritual: 'example', behavior: 3, daysAgo: 3,
        notes: 'Example. Six wins named. The customer-support team came up twice.' },
      // Today, so "Practiced this week" on the home page is never empty.
      { system: 'Meetings', behavior: 1, daysAgo: 0,
        notes: 'Example. Commitments read back at the open; one date moved, and it was said before it passed.' }
    ],
    recognition: {
      behavior: 3, daysAgo: 4, recipient: 'A teammate', title: 'Named the people behind the launch',
      body: 'Example. At the all-hands, they listed by name the four people who made the launch happen, and what each one did. Two of them had never been mentioned in a meeting before.'
    },
    story: {
      behavior: 2, daysAgo: 6,
      body: 'Example. A project lead said in week two that the deadline was not going to hold. We moved scope instead of finding out in week eight.'
    }
  },
  // A Value award in the catalog, and one given to an example team, so the
  // Awards page shows what a crest looks like. The team has nobody on it.
  award: {
    team: 'Example team',
    type: {
      name: 'The Keystone Award', grantable_to: 'both',
      description: 'For carrying our values when it would have been easier not to.',
      values: ['Challenge', 'Care']
    },
    grant: {
      daysAgo: 5,
      citation: 'Example. Held every commitment through the move to the new system, and named each person who made it work.'
    }
  },
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
      values: ['Challenge']
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
      values: ['Candor', 'Challenge']
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
    <li><strong>Cadence</strong>: the weekly practice session, the rituals and the systems that carry them.</li>
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
      // R4: every new portal starts a 30-day trial of the unlimited plan, with
      // no card and no plan to pick. Its prices come from the platform defaults.
      const plan = 'unlimited';
      const cycle = null;
      const trialEnds = new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10);
      const { data: platform } = await admin.from('platform_settings').select('rates').eq('id', 1).maybeSingle();
      const r = platform?.rates;
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
        plan, billing_cycle: cycle, trial_ends_at: trialEnds, trial_used: true,
        ...(r ? {
          rate_small_monthly: r.small.monthly, rate_small_yearly: r.small.yearly,
          rate_unlimited_monthly: r.unlimited.monthly, rate_unlimited_yearly: r.unlimited.yearly
        } : {}),
        has_example_content: true, weekly_set_at: new Date().toISOString()
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
      const { data: systems } = await admin.from('system_categories').insert(
        EXAMPLE.systems.map((name, i) => ({ org_id: org.id, name, position: i, is_example: true }))
      ).select();
      const { data: practice } = await admin.from('rituals')
        .insert({ org_id: org.id, ...EXAMPLE.practiceRitual }).select().single();
      const { behaviors: ritualFor, ...ritualFields } = EXAMPLE.ritual;
      const { data: ritual } = await admin.from('rituals')
        .insert({ org_id: org.id, ...ritualFields, is_example: true }).select().single();

      const valueId = Object.fromEntries((values ?? []).map((v) => [v.name, v.id]));
      const systemId = Object.fromEntries((systems ?? []).map((s) => [s.name, s.id]));
      const behaviorId: Record<number, string> = {};
      for (const b of EXAMPLE.behaviors) {
        const { values: names, ...rest } = b;
        const { data: row } = await admin.from('behaviors')
          .insert({ org_id: org.id, ...rest, is_example: true }).select().single();
        if (row) {
          behaviorId[b.number] = row.id;
          await admin.from('behavior_values').insert(
            names.map((n) => ({ behavior_id: row.id, value_id: valueId[n] })).filter((x) => x.value_id)
          );
          if (b.number === 1) {
            await admin.from('organizations').update({ weekly_behavior_id: row.id }).eq('id', org.id);
          }
        }
      }

      // Systems and the example ritual, applied to the example behaviors.
      await admin.from('placements').insert(EXAMPLE.placements
        .filter((p) => behaviorId[p.number] && systemId[p.system])
        .map((p) => ({
          org_id: org.id, behavior_id: behaviorId[p.number], system_category_id: systemId[p.system],
          owner: p.owner, cadence: p.cadence, artifact: p.artifact, template: p.template
        })));
      if (ritual) {
        await admin.from('behavior_rituals').insert(ritualFor
          .filter((n) => behaviorId[n]).map((n) => ({ behavior_id: behaviorId[n], ritual_id: ritual.id })));
      }

      // A little history in the champion's name. Everything is marked as an
      // example, so "Clear example content" takes it away with the rest.
      const champ = { id: created.user.id, name: championName.trim() };
      const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
      const { runs, recognition, story } = EXAMPLE.activity;
      await admin.from('iterations').insert(runs
        .filter((x) => behaviorId[x.behavior])
        .map((x) => ({
          org_id: org.id,
          ritual_id: x.ritual === 'practice' ? practice?.id ?? null : x.ritual === 'example' ? ritual?.id ?? null : null,
          system_category_id: x.system ? systemId[x.system] ?? null : null,
          behavior_ids: [behaviorId[x.behavior]],
          recorded_by: champ.id, recorded_by_name: champ.name,
          held_at: daysAgo(x.daysAgo), created_at: daysAgo(x.daysAgo),
          notes: x.notes, is_example: true
        }))
        .filter((x) => x.ritual_id || x.system_category_id));
      if (behaviorId[recognition.behavior]) {
        await admin.from('recognitions').insert({
          org_id: org.id, behavior_id: behaviorId[recognition.behavior],
          author_id: champ.id, author_name: champ.name,
          recipient: recognition.recipient, recipient_user_id: null, title: recognition.title,
          body: recognition.body, created_at: daysAgo(recognition.daysAgo), is_example: true
        });
      }
      if (behaviorId[story.behavior]) {
        await admin.from('stories').insert({
          org_id: org.id, behavior_id: behaviorId[story.behavior],
          author_id: champ.id, author_name: champ.name,
          body: story.body, created_at: daysAgo(story.daysAgo), is_example: true
        });
      }

      const { award } = EXAMPLE;
      const { data: team } = await admin.from('teams')
        .insert({ org_id: org.id, name: award.team, is_example: true }).select().single();
      const { values: awardValues, ...typeFields } = award.type;
      const { data: awardType } = await admin.from('award_types')
        .insert({ org_id: org.id, ...typeFields, is_example: true }).select().single();
      if (awardType) {
        await admin.from('award_type_values').insert(awardValues
          .filter((n) => valueId[n]).map((n) => ({ award_type_id: awardType.id, value_id: valueId[n] })));
      }
      if (team && awardType) {
        await admin.from('award_grants').insert({
          org_id: org.id, award_type_id: awardType.id, team_id: team.id, recipient_name: team.name,
          granted_by: champ.id, granted_by_name: champ.name, citation: award.grant.citation,
          granted_at: daysAgo(award.grant.daysAgo), is_example: true
        });
      }

      await sendWelcome(org.name, email, championName.trim(), 'culture champion');
      {
        await admin.from('billing_events').insert({
          org_id: org.id, kind: 'trial-started',
          detail: { plan, cycle, until: trialEnds, by: championName.trim() }
        });
      }

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
