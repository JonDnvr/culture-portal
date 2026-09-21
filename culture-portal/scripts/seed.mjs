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

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const data = JSON.parse(await readFile(new URL('./seed-data.json', import.meta.url)));
const src = data[orgKey];
if (!src) throw new Error(`No organization "${orgKey}" in seed-data.json. Available: ${Object.keys(data).join(', ')}`);

console.log(`Seeding ${src.name}…`);

/* 1. organization */
const { data: org, error: orgErr } = await db
  .from('organizations')
  .upsert({
    slug: orgKey,
    name: src.name,
    subtitle: src.sub,
    initials: src.initials,
    accent: src.accent,
    vision: src.vision,
    mission: src.mission,
    creed: src.creed,
    plan: 'pilot',
    seat_limit: 25,
    results: src.results ?? []
  }, { onConflict: 'slug' })
  .select()
  .single();
if (orgErr) throw orgErr;

/* 2. clear previous content so the script is idempotent */
await db.from('behaviors').delete().eq('org_id', org.id);
await db.from('rituals').delete().eq('org_id', org.id);
await db.from('values_').delete().eq('org_id', org.id);
await db.from('system_categories').delete().eq('org_id', org.id);

/* 3. values */
const { data: values, error: valErr } = await db
  .from('values_')
  .insert(src.values.map((v, i) => ({ org_id: org.id, name: v.n, description: v.d, position: i })))
  .select();
if (valErr) throw valErr;
const valueByName = Object.fromEntries(values.map((v) => [v.name, v.id]));

/* 4. system categories */
const { data: systems, error: sysErr } = await db
  .from('system_categories')
  .insert(src.sysCats.map((name, i) => ({ org_id: org.id, name, position: i })))
  .select();
if (sysErr) throw sysErr;
const systemByName = Object.fromEntries(systems.map((s) => [s.name, s.id]));

/* 5. rituals */
const { data: rituals, error: ritErr } = await db
  .from('rituals')
  .insert(src.rituals.map((r) => ({
    org_id: org.id, name: r.n, cadence: r.when, owner: r.owner,
    description: r.d, practice: r.tmpl ?? null
  })))
  .select();
if (ritErr) throw ritErr;
const ritualBySeedId = Object.fromEntries(src.rituals.map((r, i) => [r.id, rituals[i].id]));

/* 6. behaviors, with their values, placements and rituals */
const behaviorBySeedId = {};
for (const b of src.foundations) {
  const { data: row, error } = await db
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
    .single();
  if (error) throw error;
  behaviorBySeedId[b.id] = row.id;

  if (b.v?.length) {
    await db.from('behavior_values').insert(
      b.v.filter((v) => valueByName[v]).map((v) => ({ behavior_id: row.id, value_id: valueByName[v] }))
    );
  }

  if (b.p?.length) {
    await db.from('placements').insert(
      b.p.filter((p) => systemByName[p.s]).map((p) => ({
        org_id: org.id,
        behavior_id: row.id,
        system_category_id: systemByName[p.s],
        owner: p.owner,
        cadence: p.cadence,
        artifact: p.artifact,
        template: p.tmpl ?? null
      }))
    );
  }

  if (b.r?.length) {
    await db.from('behavior_rituals').insert(
      b.r.filter((r) => ritualBySeedId[r]).map((r) => ({ behavior_id: row.id, ritual_id: ritualBySeedId[r] }))
    );
  }
}

/* 7. behavior of the week */
if (src.weekly && behaviorBySeedId[src.weekly]) {
  await db.from('organizations').update({ weekly_behavior_id: behaviorBySeedId[src.weekly] }).eq('id', org.id);
}

/* 8. accounts */
if (withUsers) {
  const users = JSON.parse(await readFile(new URL('./seed-users.json', import.meta.url)));
  const superPw = process.env.SUPER_USER_PASSWORD;
  const demoPw = process.env.DEMO_USER_PASSWORD;

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
      if (error) { console.log(`${u.email}: ${error.message}`); continue; }
      account = created.user;
    } else {
      await db.auth.admin.updateUserById(account.id, { password });
    }

    if (u.super) {
      // The super user is a platform admin and belongs to no single org.
      await db.from('platform_admins').upsert({ user_id: account.id });
      console.log(`${u.email} is the super user.`);
    } else {
      await db.from('memberships').upsert(
        { org_id: org.id, user_id: account.id, role: u.role, display_name: u.name, email: u.email },
        { onConflict: 'user_id' }
      );
      console.log(`${u.email} -> ${src.name} as ${u.role}.`);
    }
  }
}

console.log(`Done: ${src.foundations.length} behaviors, ${src.rituals.length} rituals, ${src.values.length} values.`);
