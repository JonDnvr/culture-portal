/**
 * Deletes an organization from Supabase completely: its content and history,
 * its stored files, and the accounts of the people in it, so the same names
 * and emails can be used again. For clearing out test organizations.
 *
 *   node scripts/purge-org.mjs "Horizon Line"          # shows what would go, deletes nothing
 *   node scripts/purge-org.mjs "Horizon Line" --yes    # deletes it
 *
 * The organization can be named by its name, its slug or its id.
 *
 *   --yes         actually delete; without it the script only reports
 *   --keep-users  delete the organization but leave its people's accounts
 *   --force       allow a pilot (Mountain Vistage, Vail Daily), an organization
 *                 with a super user arrangement, or one with a live Stripe
 *                 subscription
 *
 * Never deleted: the super user, and anyone who belongs to another
 * organization. Stripe is not touched; a customer or subscription there is
 * reported so it can be cancelled in the Stripe dashboard.
 *
 * Uses the service role key, so run it locally only. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY come from the environment or a .env file next to
 * package.json. When they are not set, the script asks the Supabase CLI for
 * the live project's key, which works whenever `supabase login` has been run.
 * The key is used for this run only and never printed or saved.
 */
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import 'dotenv/config';

// The live project, the same one vite.config.js builds against.
const PROJECT_REF = 'scypggscxntpaakdjelr';

/** The service role key from the Supabase CLI, or null if the CLI cannot give it. */
function keyFromCli(ref) {
  try {
    const out = execSync(`supabase projects api-keys --project-ref ${ref} -o json`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true });
    const keys = JSON.parse(out.slice(out.indexOf('[')));
    return keys.find((k) => k.name === 'service_role')?.api_key ?? null;
  } catch { return null; }
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const ref = process.env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? PROJECT_REF;
  const key = keyFromCli(ref);
  if (key) {
    process.env.SUPABASE_URL ??= `https://${ref}.supabase.co`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    console.log(`Using the service role key for ${ref} from the Supabase CLI.`);
  }
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));
const doIt = flags.has('--yes');
const keepUsers = flags.has('--keep-users');
const force = flags.has('--force');

if (!target) {
  console.error('Name the organization: node scripts/purge-org.mjs "Horizon Line" [--yes]');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing credentials, and the Supabase CLI could not supply them.');
  console.error('Run "supabase login" and try again, or set SUPABASE_SERVICE_ROLE_KEY in this');
  console.error('window from Project Settings, API Keys, service_role.');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const PILOTS = ['mv', 'vd'];
const BUCKETS = ['story-media', 'avatars', 'logos'];
// Everything below goes with the organization (on delete cascade); counted
// here only so the report says what is about to disappear.
const TABLES = [
  'memberships', 'teams', 'values_', 'behaviors', 'system_categories', 'placements', 'rituals',
  'iterations', 'stories', 'recognitions', 'award_types', 'award_grants', 'measures',
  'measure_entries', 'pulse_responses', 'pulse_rounds', 'access_requests', 'billing_events',
  'billing_notices'
];

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/* 1. which organization */
const { data: orgs, error: orgErr } = await db.from('organizations').select('*').order('name');
if (orgErr) fail(`Could not read organizations: ${orgErr.message}`);
const wanted = target.trim().toLowerCase();
const matches = orgs.filter((o) => o.id === target || o.slug === target || o.name.toLowerCase() === wanted);
if (!matches.length) {
  fail(`No organization called "${target}". There are:\n` +
    orgs.map((o) => `  ${o.name}  (slug ${o.slug})`).join('\n'));
}
if (matches.length > 1) {
  fail(`More than one organization matches "${target}". Use its slug or id:\n` +
    matches.map((o) => `  ${o.name}  slug ${o.slug}  id ${o.id}  created ${o.created_at?.slice(0, 10)}`).join('\n'));
}
const org = matches[0];

/* 2. what would stop us */
const stops = [];
if (PILOTS.includes(org.slug)) stops.push('it is a pilot organization');
if (org.override_kind) stops.push(`it has a super user arrangement (${org.override_kind} through ${org.override_until})`);
const liveSub = org.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(org.subscription_status ?? 'active');
if (liveSub) stops.push(`it has a Stripe subscription (${org.stripe_subscription_id}); cancel it in Stripe first`);

/* 3. what goes */
const counts = {};
for (const t of TABLES) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true }).eq('org_id', org.id);
  counts[t] = error ? `? (${error.message})` : count;
}

async function listFiles(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) {
      if (/not found/i.test(error.message)) return out;
      throw new Error(`${bucket}/${prefix}: ${error.message}`);
    }
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      // Folders come back without an id.
      if (entry.id === null) out.push(...await listFiles(bucket, path));
      else out.push(path);
    }
    if (data.length < 1000) return out;
  }
}
const files = {};
for (const bucket of BUCKETS) files[bucket] = await listFiles(bucket, org.id);

const { data: members } = await db.from('memberships')
  .select('user_id, email, display_name, role').eq('org_id', org.id);
const { data: requests } = await db.from('access_requests')
  .select('user_id, email, name').eq('org_id', org.id).not('user_id', 'is', null);
const { data: admins } = await db.from('platform_admins').select('user_id');
const superIds = new Set((admins ?? []).map((a) => a.user_id));

const people = new Map();
for (const m of members ?? []) people.set(m.user_id, { email: m.email, name: m.display_name, why: m.role });
for (const r of requests ?? []) if (!people.has(r.user_id)) people.set(r.user_id, { email: r.email, name: r.name, why: 'asked to join' });

// Keep anyone who is the super user or belongs to another organization.
const ids = [...people.keys()];
const { data: elsewhere } = ids.length
  ? await db.from('memberships').select('user_id').in('user_id', ids).neq('org_id', org.id)
  : { data: [] };
const kept = new Set([...(elsewhere ?? []).map((m) => m.user_id), ...ids.filter((id) => superIds.has(id))]);
const accounts = keepUsers ? [] : ids.filter((id) => !kept.has(id));

/* 4. report */
console.log(`\n${doIt ? 'Deleting' : 'Would delete'}: ${org.name}  (slug ${org.slug}, id ${org.id}, created ${org.created_at?.slice(0, 10)})`);
console.log('\nRows that go with it:');
for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t.padEnd(18)} ${n}`);
console.log('\nStored files:');
for (const [b, list] of Object.entries(files)) console.log(`  ${b.padEnd(18)} ${list.length}`);
console.log(`\nAccounts ${keepUsers ? '(kept, --keep-users)' : 'deleted, so the emails can be used again'}:`);
for (const id of ids) {
  const p = people.get(id);
  const note = keepUsers ? 'kept' : superIds.has(id) ? 'kept: super user' : kept.has(id) ? 'kept: in another organization' : 'deleted';
  console.log(`  ${(p.email ?? id).padEnd(36)} ${String(p.why).padEnd(14)} ${note}`);
}
if (!ids.length) console.log('  none');
if (org.stripe_customer_id) {
  console.log(`\nStripe customer ${org.stripe_customer_id} is not touched. Delete it in the Stripe dashboard if it was a test.`);
}

if (stops.length && !force) {
  fail(`Stopped, because ${stops.join('; and ')}. Add --force if you are sure.`);
}
if (!doIt) {
  console.log('\nNothing has been deleted. Run the same command with --yes to delete it.');
  process.exit(0);
}

/* 5. delete: files, then the organization (everything else goes with it), then accounts */
for (const [bucket, list] of Object.entries(files)) {
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await db.storage.from(bucket).remove(list.slice(i, i + 100));
    if (error) fail(`Could not delete files in ${bucket}: ${error.message}. Nothing else has been deleted yet.`);
  }
}

const { error: delErr } = await db.from('organizations').delete().eq('id', org.id);
if (delErr) fail(`Could not delete the organization: ${delErr.message}. Its files are already gone.`);

const failed = [];
for (const id of accounts) {
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) failed.push(`${people.get(id)?.email ?? id}: ${error.message}`);
}

console.log(`\nDeleted ${org.name}, ${Object.values(files).reduce((n, l) => n + l.length, 0)} files and ${accounts.length - failed.length} accounts.`);
if (failed.length) {
  console.log(`\nThese accounts could not be deleted:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
