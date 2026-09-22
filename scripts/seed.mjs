/**
 * Seeds an organization from scripts/seed-data.json, and optionally its people.
 *
 *   node scripts/seed.mjs mv                 # content only
 *   node scripts/seed.mjs mv --with-users    # content plus the seeded accounts
 *
 * Accounts come from scripts/seed-users.json. Set SUPER_USER_PASSWORD and
 * DEMO_USER_PASSWORD in the environment; passwords are never written to a file
 * in this repository.
 *
 * Uses the service role key, so run it locally or in CI only. Re-running is
 * safe: organizations are matched on slug and their content is replaced.
 */
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import 'dotenv/config';

const [, , orgKey = 'mv', ...flags] = process.argv;
const withUsers = flags.includes('--with-users');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing credentials. Put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in a .env file');
  console.error('next to package.json. See DEPLOYMENT.md, Part 12.1.');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const data = JSON.parse(await readFile(new URL('./seed-data.json', import.meta.url)));
const src = data[orgKey];
if (!src) throw new Error(`No organization "${orgKey}" in seed-data.json. Available: ${Object.keys(data).join(', ')}`);

console.log(`Seeding ${src.name}…`);

/** Stop on the first failed write, and say which step it was. */
function check(step, result) {
  if (result?.error) {
    console.error(`\nFailed at: ${step}`);
    console.error(result.error.message ?? result.error);
    process.exit(1);
  }
  return result?.data;
}

/* 1. organization */
// Billing fields are only written when the organization is first created.
// On a re-run they are left alone, so a real plan or payment is never undone.
const { data: existingOrg } = await db
  .from('organizations').select('id').eq('slug', orgKey).maybeSingle();

const profile = {
  slug: orgKey,
  name: src.name,
  subtitle: src.sub,
  initials: src.initials,
  accent: src.accent,
  vision: src.vision,
  mission: src.mission,
  creed: src.creed,
  weekly_set_at: new Date().toISOString()
};

// The seeded organizations are paid pilots. On the free tier only the culture
// champion could sign in, and the database would refuse the other accounts.
const firstRun = {
  plan: 'unlimited',
  billing_cycle: 'yearly',
  paid_through: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)
};

let org;
if (existingOrg) {
  org = check('updating the organization',
    await db.from('organizations').update(profile).eq('id', existingOrg.id).select().single());
} else {
  org = check('creating the organization',
    await db.from('organizations').insert({ ...profile, ...firstRun }).select().single());
}

/* 2. clear previous content so the script can be run again safely */
check('clearing behaviors', await db.from('behaviors').delete().eq('org_id', org.id));
check('clearing rituals', await db.from('rituals').delete().eq('org_id', org.id));
check('clearing values', await db.from('values_').delete().eq('org_id', org.id));
check('clearing system categories', await db.from('system_categories').delete().eq('org_id', org.id));
check('clearing measure entries', await db.from('measure_entries').delete().eq('org_id', org.id));
check('clearing measures', await db.from('measures').delete().eq('org_id', org.id));

/* 3. values */
const values = check('adding values', await db
  .from('values_')
  .insert(src.values.map((v, i) => ({ org_id: org.id, name: v.n, description: v.d, position: i })))
  .select());
const valueByName = Object.fromEntries(values.map((v) => [v.name, v.id]));

/* 4. system categories */
const systems = check('adding system categories', await db
  .from('system_categories')
  .insert(src.sysCats.map((name, i) => ({ org_id: org.id, name, position: i })))
  .select());
const systemByName = Object.fromEntries(systems.map((s) => [s.name, s.id]));

/* 5. rituals */
// Every organization gets the weekly practice session. It applies to every
// behavior, so it needs no links in behavior_rituals.
check('adding the practice session', await db.from('rituals').insert({
  org_id: org.id,
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
}));

const rituals = check('adding rituals', await db
  .from('rituals')
  .insert(src.rituals.map((r) => ({
    org_id: org.id, name: r.n, cadence: r.when, owner: r.owner,
    description: r.d, practice: r.tmpl ?? null
  })))
  .select());
const ritualBySeedId = Object.fromEntries(src.rituals.map((r, i) => [r.id, rituals[i].id]));

/* 6. behaviors, with their values, placements and rituals */
const behaviorBySeedId = {};
for (const b of src.foundations) {
  const row = check(`adding behavior ${b.n}`, await db
    .from('behaviors')
    .insert({
      org_id: org.id,
      number: b.n,
      title: b.t,
      description: b.d,
      category: b.c,
      quick_tip: b.tip,
      coaching_tips: b.coach,
      teaching_points: b.teach,
      questions: b.qs,
      failure_state: b.miss,
      hard_rule: b.rule
    })
    .select()
    .single());
  behaviorBySeedId[b.id] = row.id;

  if (b.v?.length) {
    check(`linking values to behavior ${b.n}`, await db.from('behavior_values').insert(
      b.v.filter((v) => valueByName[v]).map((v) => ({ behavior_id: row.id, value_id: valueByName[v] }))
    ));
  }

  if (b.p?.length) {
    check(`adding systems for behavior ${b.n}`, await db.from('placements').insert(
      b.p.filter((p) => systemByName[p.s]).map((p) => ({
        org_id: org.id,
        behavior_id: row.id,
        system_category_id: systemByName[p.s],
        owner: p.owner,
        cadence: p.cadence,
        artifact: p.artifact,
        template: p.tmpl ?? null
      }))
    ));
  }

  if (b.r?.length) {
    check(`linking rituals to behavior ${b.n}`, await db.from('behavior_rituals').insert(
      b.r.filter((r) => ritualBySeedId[r]).map((r) => ({ behavior_id: row.id, ritual_id: ritualBySeedId[r] }))
    ));
  }
}

/* 7. behavior of the week */
if (src.weekly && behaviorBySeedId[src.weekly]) {
  check('setting the behavior of the week', await db.from('organizations')
    .update({ weekly_behavior_id: behaviorBySeedId[src.weekly] }).eq('id', org.id));
}

/* 7b. measures, and one recorded period so Conviction has something to show */
if (src.results?.length) {
  const measures = check('adding measures', await db.from('measures').insert(
    src.results.map((r, i) => ({ org_id: org.id, name: r.m, note: r.trend ?? '', position: i }))
  ).select());
  check('recording the first period', await db.from('measure_entries').insert({
    org_id: org.id,
    period: 'Starting point',
    values: Object.fromEntries(measures.map((m, i) => [m.id, src.results[i].now ?? ''])),
    recorded_by_name: 'Seed'
  }));
}

/* 8. accounts */
if (withUsers) {
  const users = JSON.parse(await readFile(new URL('./seed-users.json', import.meta.url)));
  const superPw = process.env.SUPER_USER_PASSWORD;
  const demoPw = process.env.DEMO_USER_PASSWORD;

  var failedAccounts = [];
  for (const u of users.filter((x) => x.super || x.org === orgKey)) {
    const password = u.super ? superPw : demoPw;
    if (!password) {
      console.log(`Skipping ${u.email}: set ${u.super ? 'SUPER_USER_PASSWORD' : 'DEMO_USER_PASSWORD'} first.`);
      continue;
    }

    const { data: existing } = await db.auth.admin.listUsers();
    let account = existing.users.find((x) => x.email?.toLowerCase() === u.email.toLowerCase());

    if (!account) {
      const { data: created, error } = await db.auth.admin.createUser({
        email: u.email, password, email_confirm: true,
        user_metadata: { display_name: u.name }
      });
      if (error) {
        console.log(`${u.email}: could not create the account. ${error.message}`);
        failedAccounts.push(u.email);
        continue;
      }
      account = created.user;
    } else {
      await db.auth.admin.updateUserById(account.id, { password });
    }

    if (u.super) {
      // The super user is a platform admin and belongs to no single org.
      check(`making ${u.email} the super user`,
        await db.from('platform_admins').upsert({ user_id: account.id }));
      console.log(`${u.email} is the super user.`);
    } else {
      check(`adding ${u.email} to ${src.name}`, await db.from('memberships').upsert(
        { org_id: org.id, user_id: account.id, role: u.role, display_name: u.name, email: u.email },
        { onConflict: 'user_id' }
      ));
      console.log(`${u.email} -> ${src.name} as ${u.role}.`);
    }
  }
}

console.log(`Done: ${src.foundations.length} behaviors, ${src.rituals.length + 1} rituals, ${src.values.length} values.`);

// Content can succeed while accounts fail; say so rather than implying all is well.
if (typeof failedAccounts !== 'undefined' && failedAccounts.length) {
  console.log(`\nBut ${failedAccounts.length} account(s) were not created: ${failedAccounts.join(', ')}`);
  console.log('Fix the message above and run the same command again. It is safe to repeat.');
  process.exit(1);
}
