/**
 * Seeds an organization from scripts/seed-data.json, and optionally its people
 * and a history of activity.
 *
 *   node scripts/seed.mjs mv                                  # content only
 *   node scripts/seed.mjs mv --with-users                     # content plus the seeded accounts
 *   node scripts/seed.mjs rr --with-users --with-activity     # plus runs, stories, recognition, awards
 *
 * Accounts come from scripts/seed-users.json. Set SUPER_USER_PASSWORD and
 * DEMO_USER_PASSWORD in the environment; passwords are never written to a file
 * in this repository.
 *
 * Uses the service role key, so run it locally or in CI only. Re-running is
 * safe: organizations are matched on slug and their content is replaced.
 * Replacing behaviors, rituals and systems also removes the stories,
 * recognition, runs and pulse answers attached to them, so do not re-run it
 * against an organization whose people have started using it.
 *
 * Optional sections of an organization in seed-data.json, beyond the content:
 *
 *   "teams":  ["Crew One", "Office"]          matched on name, never deleted
 *   "awards": [{ "id": "a1", "n": "Name", "d": "What it is for",
 *                "to": "member" | "team" | "both", "cap": 1, "per": "month" | "quarter" | "year",
 *                "v": ["Value name", ...] }]  matched on name
 *
 * Activity, written only with --with-activity. People are an email from
 * seed-users.json or a role ("champion", "leader", ...); "ago" is days before
 * the day the script runs, so the history is always recent.
 *
 *   "runs":        [{ "ritual": "r1" | "practice-session", "b": ["b3"], "by": "leader",
 *                     "team": "Crew One", "ago": 2, "notes": "" }]
 *                  or { "system": "Onboarding", ... } for a run of a system
 *   "stories":     [{ "f": "b3", "by": "member", "ago": 5, "txt": "..." }]
 *   "recognition": [{ "f": "b3", "by": "leader", "to": "member" | "a typed name",
 *                     "title": "...", "ago": 9, "txt": "..." }]
 *   "grants":      [{ "award": "a1", "to": "member" | "team": "Crew One",
 *                     "by": "champion", "ago": 20, "txt": "the citation" }]
 *
 * A story or recognition without "by" is credited to the culture champion
 * under its "who" name, which is how the older entries are written.
 */
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import 'dotenv/config';

const [, , orgKey = 'mv', ...flags] = process.argv;
const withUsers = flags.includes('--with-users');
const withActivity = flags.includes('--with-activity');

const data = JSON.parse(await readFile(new URL('./seed-data.json', import.meta.url)));
const src = data[orgKey];
if (!src) throw new Error(`No organization "${orgKey}" in seed-data.json. Available: ${Object.keys(data).join(', ')}`);
const users = JSON.parse(await readFile(new URL('./seed-users.json', import.meta.url)));
const orgUsers = users.filter((u) => u.org === orgKey);

const PRACTICE = 'practice-session';
const ROLES = ['member', 'leader', 'admin', 'champion'];
const DAY = 86400000;
const isPersonRef = (x) => typeof x === 'string' && (x.includes('@') || ROLES.includes(x));
const daysAgo = (n) => new Date(Date.now() - (n ?? 0) * DAY).toISOString();

/* 0. check every reference in the seed data before writing anything */
{
  const { problems, warnings } = preflight();
  for (const w of warnings) console.log(`Note: ${w}`);
  if (problems.length) {
    console.error(`seed-data.json has ${problems.length} problem(s) for "${orgKey}":`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing credentials. Put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in a .env file');
  console.error('next to package.json. See DEPLOYMENT.md, Part 12.1.');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

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

/** Stop with a message that is not a database error. */
function fail(step, message) {
  console.error(`\nFailed at: ${step}`);
  console.error(message);
  process.exit(1);
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
  paid_through: new Date(Date.now() + 365 * DAY).toISOString().slice(0, 10)
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
// Stories, recognition, runs and pulse answers go with the behaviors, rituals
// and systems they hang from.
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
const practice = check('adding the practice session', await db.from('rituals').insert({
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
}).select().single());

const rituals = check('adding rituals', await db
  .from('rituals')
  .insert(src.rituals.map((r) => ({
    org_id: org.id, name: r.n, cadence: r.when, owner: r.owner,
    description: r.d, practice: r.tmpl ?? null
  })))
  .select());
const ritualBySeedId = Object.fromEntries(src.rituals.map((r, i) => [r.id, rituals[i].id]));
ritualBySeedId[PRACTICE] = practice.id;

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

/* 9. teams, and who is on each */
// Matched on name and never deleted, so a real organization's teams and the
// people already on them are left as they are.
const teamByName = {};
if (src.teams?.length) {
  const existing = check('reading teams', await db.from('teams').select('id, name').eq('org_id', org.id));
  for (const t of existing) teamByName[t.name.toLowerCase()] = t.id;
  const missing = src.teams.filter((name) => !teamByName[name.toLowerCase()]);
  if (missing.length) {
    const added = check('adding teams', await db.from('teams')
      .insert(missing.map((name) => ({ org_id: org.id, name }))).select('id, name'));
    for (const t of added) teamByName[t.name.toLowerCase()] = t.id;
  }
  for (const u of orgUsers.filter((x) => x.team)) {
    check(`putting ${u.email} on ${u.team}`, await db.from('memberships')
      .update({ team_id: teamByName[u.team.toLowerCase()] })
      .eq('org_id', org.id).eq('email', u.email));
  }
}

/* 10. the award catalog */
// Matched on name, like teams. Its Values are rewritten each time.
const awardBySeedId = {};
if (src.awards?.length) {
  const existing = check('reading awards', await db.from('award_types').select('id, name').eq('org_id', org.id));
  for (const a of src.awards) {
    const fields = {
      org_id: org.id, name: a.n, description: a.d ?? null, grantable_to: a.to ?? 'both',
      grant_cap: a.cap ?? null, cap_period: a.per ?? null, active: true
    };
    const found = existing.find((x) => x.name.toLowerCase() === a.n.toLowerCase());
    const row = found
      ? check(`updating award ${a.n}`, await db.from('award_types').update(fields).eq('id', found.id).select().single())
      : check(`adding award ${a.n}`, await db.from('award_types').insert(fields).select().single());
    awardBySeedId[a.id] = row;

    check(`clearing values for award ${a.n}`, await db.from('award_type_values').delete().eq('award_type_id', row.id));
    if (a.v?.length) {
      check(`linking values to award ${a.n}`, await db.from('award_type_values').insert(
        a.v.map((v) => ({ award_type_id: row.id, value_id: valueByName[v] }))
      ));
    }
  }
}

/* 11. activity: runs of rituals and systems, stories, recognition, awards given */
const counts = { runs: 0, stories: 0, recognition: 0, grants: 0 };
if (withActivity) {
  const people = check('reading the people', await db.from('memberships')
    .select('user_id, email, role, display_name').eq('org_id', org.id));
  const champion = people.find((p) => p.role === 'champion');

  /** An email or a role, as the seed data writes it, to an account in this org. */
  const person = (ref, step) => {
    const p = ref.includes('@')
      ? people.find((m) => m.email?.toLowerCase() === ref.toLowerCase())
      : people.find((m) => m.role === ref);
    if (!p) fail(step, `Nobody in ${src.name} matches "${ref}". Run with --with-users, or check seed-users.json.`);
    return { id: p.user_id, name: p.display_name ?? p.email };
  };
  const author = (entry, step) => {
    if (entry.by) return person(entry.by, step);
    if (!champion) fail(step, `${src.name} has no culture champion to credit this to. Give it a "by".`);
    return { id: champion.user_id, name: entry.who ?? champion.display_name ?? champion.email };
  };

  // Awards are not attached to any content, so replacing the content above
  // left them in place. Clear them so a re-run does not double them.
  check('clearing awards given', await db.from('award_grants').delete().eq('org_id', org.id));

  if (src.runs?.length) {
    const rows = src.runs.map((r, i) => {
      const by = person(r.by ?? 'champion', `run ${i + 1}`);
      return {
        org_id: org.id,
        ritual_id: r.ritual ? ritualBySeedId[r.ritual] : null,
        system_category_id: r.system ? systemByName[r.system] : null,
        behavior_ids: (r.b ?? []).map((id) => behaviorBySeedId[id]),
        team_id: r.team ? teamByName[r.team.toLowerCase()] : null,
        recorded_by: by.id,
        recorded_by_name: by.name,
        held_at: daysAgo(r.ago),
        created_at: daysAgo(r.ago),
        notes: r.notes ?? ''
      };
    });
    check('adding ritual and system runs', await db.from('iterations').insert(rows));
    counts.runs = rows.length;
  }

  if (src.stories?.length) {
    const rows = src.stories.map((s, i) => {
      const by = author(s, `story ${i + 1}`);
      return {
        org_id: org.id, behavior_id: behaviorBySeedId[s.f],
        author_id: by.id, author_name: by.name, body: s.txt,
        created_at: daysAgo(s.ago ?? (i + 1) * 5)
      };
    });
    check('adding stories', await db.from('stories').insert(rows));
    counts.stories = rows.length;
  }

  if (src.recognition?.length) {
    const rows = src.recognition.map((r, i) => {
      const step = `recognition ${i + 1}`;
      const by = author(r, step);
      // A person in the organization gets the gold star; a typed name does not.
      const to = isPersonRef(r.to) ? person(r.to, step) : null;
      if (to && to.id === by.id) fail(step, `${by.name} cannot recognize themselves.`);
      return {
        org_id: org.id, behavior_id: behaviorBySeedId[r.f],
        author_id: by.id, author_name: by.name,
        recipient: to ? to.name : r.to, recipient_user_id: to ? to.id : null,
        title: r.title ?? null, body: r.txt,
        created_at: daysAgo(r.ago ?? (i + 1) * 5)
      };
    });
    check('adding recognition', await db.from('recognitions').insert(rows));
    counts.recognition = rows.length;
  }

  // One at a time, oldest first, so an award over its limit names itself.
  const grants = [...(src.grants ?? [])].sort((a, b) => (b.ago ?? 0) - (a.ago ?? 0));
  for (const g of grants) {
    const award = awardBySeedId[g.award];
    const step = `giving ${award.name}`;
    const by = person(g.by ?? 'champion', step);
    const to = g.team
      ? { team_id: teamByName[g.team.toLowerCase()], recipient_user_id: null, recipient_name: g.team }
      : (() => {
          const p = person(g.to, step);
          if (p.id === by.id) fail(step, `${by.name} cannot give an award to themselves.`);
          return { team_id: null, recipient_user_id: p.id, recipient_name: p.name };
        })();
    check(`${step} to ${to.recipient_name}`, await db.from('award_grants').insert({
      org_id: org.id, award_type_id: award.id, ...to,
      granted_by: by.id, granted_by_name: by.name,
      citation: g.txt, granted_at: daysAgo(g.ago)
    }));
    counts.grants++;
  }
}

console.log(`Done: ${src.foundations.length} behaviors, ${src.rituals.length + 1} rituals, ${src.values.length} values.`);
if (src.teams?.length || src.awards?.length) {
  console.log(`      ${src.teams?.length ?? 0} teams, ${src.awards?.length ?? 0} awards in the catalog.`);
}
if (withActivity) {
  console.log(`      ${counts.runs} runs, ${counts.stories} stories, ${counts.recognition} recognitions, ${counts.grants} awards given.`);
}

// Content can succeed while accounts fail; say so rather than implying all is well.
if (typeof failedAccounts !== 'undefined' && failedAccounts.length) {
  console.log(`\nBut ${failedAccounts.length} account(s) were not created: ${failedAccounts.join(', ')}`);
  console.log('Fix the message above and run the same command again. It is safe to repeat.');
  process.exit(1);
}

/**
 * Every name and id the seed data refers to, checked against the seed data
 * itself, so a typo stops the script before anything is written.
 */
function preflight() {
  const problems = [];
  const warnings = [];
  const behaviorIds = new Set(src.foundations.map((b) => b.id));
  const ritualIds = new Set([PRACTICE, ...src.rituals.map((r) => r.id)]);
  const systemNames = new Set(src.sysCats);
  const teamNames = new Set((src.teams ?? []).map((t) => t.toLowerCase()));
  const valueNames = new Set(src.values.map((v) => v.n));
  const awards = new Map((src.awards ?? []).map((a) => [a.id, a]));

  const personKnown = (ref) => ref.includes('@')
    ? orgUsers.some((u) => u.email.toLowerCase() === ref.toLowerCase())
    : orgUsers.some((u) => u.role === ref);
  const needPerson = (ref, where) => {
    if (ref && !personKnown(ref)) problems.push(`${where}: nobody in seed-users.json for "${orgKey}" matches "${ref}"`);
  };
  const needBehavior = (id, where) => {
    if (!behaviorIds.has(id)) problems.push(`${where}: no behavior with id "${id}"`);
  };
  const needTeam = (name, where) => {
    if (name && !teamNames.has(name.toLowerCase())) problems.push(`${where}: "${name}" is not in "teams"`);
  };

  for (const u of orgUsers) needTeam(u.team, `seed-users.json, ${u.email}`);

  for (const a of src.awards ?? []) {
    const where = `award "${a.n ?? a.id}"`;
    if (!a.id || !a.n) problems.push(`${where}: needs an "id" and an "n"`);
    if (a.to && !['member', 'team', 'both'].includes(a.to)) problems.push(`${where}: "to" must be member, team or both`);
    if (a.per && !['month', 'quarter', 'year'].includes(a.per)) problems.push(`${where}: "per" must be month, quarter or year`);
    if (!!a.cap !== !!a.per) problems.push(`${where}: "cap" and "per" go together`);
    for (const v of a.v ?? []) if (!valueNames.has(v)) problems.push(`${where}: no value named "${v}"`);
  }

  (src.runs ?? []).forEach((r, i) => {
    const where = `run ${i + 1}`;
    if (!!r.ritual === !!r.system) problems.push(`${where}: give a "ritual" or a "system", not both`);
    if (r.ritual && !ritualIds.has(r.ritual)) problems.push(`${where}: no ritual with id "${r.ritual}"`);
    if (r.system && !systemNames.has(r.system)) problems.push(`${where}: "${r.system}" is not in "sysCats"`);
    for (const b of r.b ?? []) needBehavior(b, where);
    needTeam(r.team, where);
    needPerson(r.by ?? 'champion', where);
    if (r.system) {
      for (const id of r.b ?? []) {
        const b = src.foundations.find((x) => x.id === id);
        if (b && !(b.p ?? []).some((p) => p.s === r.system)) {
          warnings.push(`${where}: behavior ${id} is not placed in ${r.system}, so this run will not show on its system tab`);
        }
      }
    }
  });

  (src.stories ?? []).forEach((s, i) => {
    const where = `story ${i + 1}`;
    needBehavior(s.f, where);
    needPerson(s.by, where);
    if (!s.txt) problems.push(`${where}: needs "txt"`);
  });

  (src.recognition ?? []).forEach((r, i) => {
    const where = `recognition ${i + 1}`;
    needBehavior(r.f, where);
    needPerson(r.by, where);
    if (!r.to) problems.push(`${where}: needs "to"`);
    else if (isPersonRef(r.to)) needPerson(r.to, where);
    if (!r.txt) problems.push(`${where}: needs "txt"`);
  });

  // The database refuses an award past its limit for the period, counted from
  // the start of this month, quarter or year, so the same count is made here.
  const given = {};
  (src.grants ?? []).forEach((g, i) => {
    const where = `award given ${i + 1}`;
    const a = awards.get(g.award);
    if (!a) { problems.push(`${where}: no award with id "${g.award}"`); return; }
    if (!!g.to === !!g.team) problems.push(`${where}: give "to" a person or "team", not both`);
    if (g.team && a.to === 'member') problems.push(`${where}: ${a.n} goes to a person, not a team`);
    if (g.to && a.to === 'team') problems.push(`${where}: ${a.n} goes to a team, not a person`);
    needTeam(g.team, where);
    if (g.to) needPerson(g.to, where);
    needPerson(g.by ?? 'champion', where);
    if (g.to && g.to === (g.by ?? 'champion')) problems.push(`${where}: nobody can give an award to themselves`);
    if (!g.txt) problems.push(`${where}: needs "txt", the citation`);
    if (a.cap && a.per && Date.now() - (g.ago ?? 0) * DAY >= periodStart(a.per)) {
      const key = `${a.id}|${g.by ?? 'champion'}`;
      given[key] = (given[key] ?? 0) + 1;
      if (given[key] === a.cap + 1) {
        problems.push(`${where}: ${g.by ?? 'champion'} would give more than ${a.cap} ${a.n} this ${a.per}; move one further back with "ago"`);
      }
    }
  });

  if (withActivity && !orgUsers.some((u) => u.role === 'champion')) {
    warnings.push(`no culture champion for "${orgKey}" in seed-users.json; every story and recognition will need a "by"`);
  }
  return { problems, warnings };
}

/** The start of this month, quarter or year, in UTC, as Postgres's date_trunc sees it. */
function periodStart(per) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (per === 'year') return Date.UTC(y, 0, 1);
  if (per === 'quarter') return Date.UTC(y, m - (m % 3), 1);
  return Date.UTC(y, m, 1);
}
