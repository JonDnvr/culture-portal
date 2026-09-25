/**
 * Local backend. Same function signatures as lib/supabase.js, but everything
 * lives in localStorage so the portal runs in a browser with no server.
 * Point VITE_SUPABASE_URL at a project and api.js switches over; nothing in
 * the views changes.
 *
 * Accounts here are demonstration only. Passwords are salted and hashed rather
 * than stored in the clear, but a browser store cannot keep a secret from
 * whoever is at the keyboard, and every tenant's data sits in the same store.
 * The real boundary is the hosted mode, where Postgres row level security
 * enforces the same rules server-side. Do not put real member data in local
 * mode.
 *
 * Other limits: localStorage holds roughly 5 MB per origin, so files over 2 MB
 * are recorded by name without their contents.
 */
import seed from '../../scripts/seed-data.json';

// Bump this whenever the store's shape changes. A store written by an older
// build is discarded and rebuilt rather than half-read.
const KEY = 'culture-portal-local-v5';
const OLD_KEYS = ['culture-portal-local-v1', 'culture-portal-local-v2', 'culture-portal-local-v3', 'culture-portal-local-v4'];
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

const uid = () => 'id-' + Math.random().toString(36).slice(2, 11);
const now = () => new Date().toISOString();

export const IS_LOCAL = true;

/* ------------------------------------------------------------------- users */

const SALT = 'culture-portal-v1';

/**
 * Seeded accounts. Only the hash is stored, never the password itself.
 * The demonstration password for every account except the super user is
 * documented in the README.
 */
const SEED_USERS = [
  { email: 'jon@horizonlinegroup.com', name: 'Jon Strickler', is_super: true, org: null, role: 'owner',
    passwordHash: '65f0d143f3c976394834e260d6cf201f4b494287dd5cb8454efdbb6ee8cf0cff' },

  { email: 'chair@mountainvistage.com', name: 'Group Chair', org: 'mv', role: 'champion',
    passwordHash: '9575a07301bcf33967a58948c6be8874f644bec5c6d7af59a710926d8ced0ce2' },
  { email: 'accountability@mountainvistage.com', name: 'Accountability Role', org: 'mv', role: 'leader',
    passwordHash: '9575a07301bcf33967a58948c6be8874f644bec5c6d7af59a710926d8ced0ce2' },
  { email: 'member@mountainvistage.com', name: 'CE Team Member', org: 'mv', role: 'member',
    passwordHash: '9575a07301bcf33967a58948c6be8874f644bec5c6d7af59a710926d8ced0ce2' },

  { email: 'editor@vaildaily.com', name: 'Managing Editor', org: 'vd', role: 'champion',
    passwordHash: '9575a07301bcf33967a58948c6be8874f644bec5c6d7af59a710926d8ced0ce2' },
  { email: 'desk@vaildaily.com', name: 'Desk Editor', org: 'vd', role: 'leader',
    passwordHash: '9575a07301bcf33967a58948c6be8874f644bec5c6d7af59a710926d8ced0ce2' },
  { email: 'reporter@vaildaily.com', name: 'Staff Reporter', org: 'vd', role: 'member',
    passwordHash: '9575a07301bcf33967a58948c6be8874f644bec5c6d7af59a710926d8ced0ce2' }
];

/** Every organization starts with this one; it applies to every behavior. */
export const DEFAULT_PRACTICE_RITUAL = {
  applies_to_all: true,
  name: 'Behavior of the week practice',
  cadence: 'Every Mtg , 3 minutes',
  owner: 'Whoever is leading the meeting',
  description: "The short session that puts the week's behavior in front of the team. It applies to every meeting for the week that has > 3 people.",
  practice: [
    '1. Read the behavior out loud.',
    '',
    "2. Ask the week's discussion question to a particular person.",
    '',
    '3. Say why it is on the list and the difference it makes.',
    '',
    '4. Who saw someone do this well?',
    '',
    '5. Someone names a place they will practice it this week.'
  ].join('\n')
};

async function hash(password) {
  const bytes = new TextEncoder().encode(`${SALT}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------- store */

function build() {
  const db = {
    sessionUserId: null,
    users: [],
    orgs: [],
    values: {}, systems: {}, behaviors: {}, rituals: {},
    stories: [], recognitions: [], iterations: [], pulse: [], shares: [], billingEvents: [],
    requests: [], resets: [], outbox: [],
    measures: {}, measureEntries: [], files: {}
  };

  for (const [slug, src] of Object.entries(seed)) {
    const orgId = 'org-' + slug;
    db.orgs.push({
      id: orgId, slug, name: src.name, subtitle: src.sub, initials: src.initials,
      accent: src.accent, vision: src.vision, mission: src.mission, creed: src.creed,
      weekly_behavior_id: null, weekly_set_at: now(),
      recent_days: 45, pulse_per_signin: 2, auto_advance: false,
      // Billing. Rates are per organization, set by the super user; the plan
      // is chosen by that organization's champion.
      plan: 'unlimited', billing_cycle: 'yearly',
      rate_small_monthly: 49, rate_small_yearly: 490,
      rate_unlimited_monthly: 149, rate_unlimited_yearly: 1490,
      paid_through: new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10),
      cancel_at_period_end: false, pending_change: null
    });

    db.values[orgId] = src.values.map((v, i) => ({
      id: uid(), org_id: orgId, name: v.n, description: v.d, position: i
    }));
    db.systems[orgId] = src.sysCats.map((name, i) => ({
      id: uid(), org_id: orgId, name, position: i
    }));
    db.rituals[orgId] = [
      { id: uid(), seedId: 'practice-session', org_id: orgId, ...DEFAULT_PRACTICE_RITUAL },
      ...src.rituals.map((r) => ({
        id: uid(), seedId: r.id, org_id: orgId, applies_to_all: false, name: r.n, cadence: r.when,
        owner: r.owner, description: r.d, practice: r.tmpl ?? null
      }))
    ];

    const valueId = Object.fromEntries(db.values[orgId].map((v) => [v.name, v.id]));
    const systemId = Object.fromEntries(db.systems[orgId].map((s) => [s.name, s.id]));
    const ritualId = Object.fromEntries(db.rituals[orgId].map((r) => [r.seedId, r.id]));

    db.behaviors[orgId] = src.foundations.map((b) => ({
      id: uid(), seedId: b.id, org_id: orgId, number: b.n, title: b.t, description: b.d,
      category: b.c, quick_tip: b.tip, coaching_tips: b.coach, teaching_points: b.teach,
      questions: b.qs, failure_state: b.miss, hard_rule: b.rule,
      valueIds: (b.v ?? []).map((n) => valueId[n]).filter(Boolean),
      ritualIds: (b.r ?? []).map((r) => ritualId[r]).filter(Boolean),
      placements: (b.p ?? []).filter((p) => systemId[p.s]).map((p) => ({
        id: uid(), systemId: systemId[p.s], owner: p.owner, cadence: p.cadence,
        artifact: p.artifact, template: p.tmpl ?? null
      }))
    }));

    const weekly = db.behaviors[orgId].find((b) => b.seedId === src.weekly);
    if (weekly) db.orgs.find((o) => o.id === orgId).weekly_behavior_id = weekly.id;

    db.measures[orgId] = (src.results ?? []).map((r, i) => ({
      id: uid(), org_id: orgId, name: r.m, note: r.trend ?? '', position: i
    }));
    if (db.measures[orgId].length) {
      db.measureEntries.push({
        id: uid(), org_id: orgId, period: 'Q3 2026', recorded_at: now(), recorded_by_name: 'Seed',
        values: Object.fromEntries(db.measures[orgId].map((m, i) => [m.id, (src.results[i].now ?? '')]))
      });
    }

    const bySeed = Object.fromEntries(db.behaviors[orgId].map((b) => [b.seedId, b.id]));
    for (const s of src.stories ?? []) {
      db.stories.push({
        id: uid(), org_id: orgId, behavior_id: bySeed[s.f], author_name: s.who,
        body: s.txt, created_at: now(), attachments: []
      });
    }
    const ritualBySeed2 = Object.fromEntries(db.rituals[orgId].map((r) => [r.seedId, r.id]));
    for (const [i, b] of db.behaviors[orgId].slice(0, 3).entries()) {
      const rid = b.ritualIds[0] ?? ritualBySeed2['practice-session'];
      db.iterations.push({
        id: uid(), org_id: orgId, ritual_id: rid, behavior_ids: [b.id],
        recorded_by: null, recorded_by_name: 'Chair',
        held_at: new Date(Date.now() - (i + 1) * 6 * 86400000).toISOString(),
        notes: i === 0 ? 'Full attendance. The question landed harder than expected.' : '',
        attachments: []
      });
    }

    for (const r of src.recognition ?? []) {
      db.recognitions.push({
        id: uid(), org_id: orgId, behavior_id: bySeed[r.f], author_name: r.who,
        recipient: r.to, body: r.txt, created_at: now(), attachments: []
      });
    }
  }
  db.users = SEED_USERS.map((u) => ({
    id: uid(),
    email: u.email.toLowerCase(),
    name: u.name,
    passwordHash: u.passwordHash,
    is_super: !!u.is_super,
    org_id: u.org ? 'org-' + u.org : null,
    role: u.role
  }));

  return db;
}

// The store is only built when this backend is the one in use, so a hosted
// build can drop the seed data and everything that reads it.
const ACTIVE = !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY;
let db = ACTIVE ? load() : {};

/** Every field the app reads, so a partial store is caught before it is used. */
function isUsable(store) {
  return !!store
    && Array.isArray(store.users) && store.users.length > 0
    && Array.isArray(store.orgs) && store.orgs.length > 0
    && Array.isArray(store.stories) && Array.isArray(store.recognitions)
    && Array.isArray(store.iterations) && Array.isArray(store.measureEntries)
    && store.behaviors && store.values && store.systems && store.rituals
    && store.measures && store.files
    && Array.isArray(store.requests) && Array.isArray(store.outbox);
}

function load() {
  try {
    for (const old of OLD_KEYS) localStorage.removeItem(old);
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isUsable(parsed)) {
        // R1 added collections rather than changing existing ones, so an
        // older store is upgraded in place instead of being thrown away.
        if (upgrade(parsed)) persist(parsed);
        return parsed;
      }
    }
  } catch { /* fall through to a fresh store */ }
  const fresh = build();
  upgrade(fresh);
  persist(fresh);
  return fresh;
}

/**
 * Brings a store up to R1: teams, avatars, award catalog and grants, fluency
 * marks, and enough history for the badges to have something to show.
 * Returns true when anything changed.
 */
function upgrade(store) {
  let changed = false;
  const need = (k, v) => { if (store[k] === undefined) { store[k] = v; changed = true; } };
  need('teams', {});
  need('awardTypes', {});
  need('awardGrants', []);
  need('fluencyMarks', []);

  const DEMO_TEAMS = { vd: ['Newsroom', 'Advertising', 'Leadership'], mv: ['CE Team', 'Chairs'] };
  for (const org of store.orgs) {
    if (!store.teams[org.id]) {
      store.teams[org.id] = (DEMO_TEAMS[org.slug] ?? []).map((name) => ({
        id: uid(), org_id: org.id, name, archived: false, created_at: now()
      }));
      changed = true;
    }
    if (!store.awardTypes[org.id]) {
      const vals = store.values[org.id] ?? [];
      store.awardTypes[org.id] = vals.length ? [
        { id: uid(), org_id: org.id, name: 'The Horizon Award', grantable_to: 'member',
          description: 'For living our values over a season, not a single moment.',
          grant_cap: 1, cap_period: 'quarter', active: true, created_at: now(),
          valueIds: vals.slice(0, 2).map((v) => v.id) },
        { id: uid(), org_id: org.id, name: 'The Summit Award', grantable_to: 'team',
          description: 'For a team that carried our values through a hard stretch together.',
          grant_cap: null, cap_period: null, active: true, created_at: now(),
          valueIds: vals.slice(0, 3).map((v) => v.id) }
      ] : [];
      changed = true;
    }
  }

  // Everyone starts on a team in the demo; in hosted mode an admin assigns them.
  for (const u of store.users) {
    if (u.org_id && u.team_id === undefined) {
      const teams = store.teams[u.org_id] ?? [];
      const byRole = u.role === 'champion' || u.role === 'admin'
        ? teams.find((t) => /lead|chair/i.test(t.name)) : null;
      u.team_id = (byRole ?? teams[0])?.id ?? null;
      u.avatar_path = u.avatar_path ?? null;
      changed = true;
    }
  }
  for (const s of store.stories) if (s.author_id === undefined) { s.author_id = null; changed = true; }

  if (!store.r1Seeded) {
    seedHistory(store);
    store.r1Seeded = true;
    changed = true;
  }
  return changed;
}

/**
 * Fourteen weeks of Behavior of the Week sessions, some ritual and system
 * runs, recognitions to real members and one Value award, so the streaks and
 * badges read as they would in an organization that has been at it a while.
 */
function seedHistory(store) {
  const week = 7 * 86400000;
  for (const org of store.orgs) {
    const behaviors = (store.behaviors[org.id] ?? []).filter((b) => !b.is_example);
    const rituals = store.rituals[org.id] ?? [];
    const session = rituals.find((r) => r.applies_to_all);
    const teams = store.teams[org.id] ?? [];
    const people = store.users.filter((u) => u.org_id === org.id);
    const leader = people.find((u) => u.role === 'leader') ?? people[0];
    const champ = people.find((u) => u.role === 'champion') ?? people[0];
    if (!behaviors.length || !session || !people.length) continue;

    const weeks = org.slug === 'vd' ? 14 : 9;
    for (let w = 0; w < weeks; w++) {
      const b = behaviors[w % behaviors.length];
      const held = new Date(Date.now() - w * week - 2 * 86400000).toISOString();
      // The first team misses a week in the middle, so its streak is shorter
      // than the organization's; the second team keeps the organization's run.
      if (w !== 6 || !teams[1]) {
        store.iterations.push({
          id: uid(), org_id: org.id, ritual_id: session.id, system_category_id: null,
          behavior_ids: [b.id], team_id: teams[0]?.id ?? null,
          recorded_by: leader.id, recorded_by_name: leader.name, held_at: held,
          notes: '', attachments: []
        });
      }
      if (teams[1]) {
        store.iterations.push({
          id: uid(), org_id: org.id, ritual_id: session.id, system_category_id: null,
          behavior_ids: [b.id], team_id: teams[1].id,
          recorded_by: champ.id, recorded_by_name: champ.name, held_at: held,
          notes: '', attachments: []
        });
      }
      if (w < 5) {
        const pb = behaviors[(w * 3 + 1) % behaviors.length];
        const r = rituals.find((x) => !x.applies_to_all && pb.ritualIds.includes(x.id));
        if (r) {
          store.iterations.push({
            id: uid(), org_id: org.id, ritual_id: r.id, system_category_id: null,
            behavior_ids: [pb.id], team_id: teams[0]?.id ?? null,
            recorded_by: leader.id, recorded_by_name: leader.name,
            held_at: new Date(Date.now() - w * week - 86400000).toISOString(), notes: '', attachments: []
          });
        }
        const placed = behaviors.find((x) => x.placements.length) ?? null;
        if (placed && w % 2 === 0) {
          store.iterations.push({
            id: uid(), org_id: org.id, ritual_id: null, system_category_id: placed.placements[0].systemId,
            behavior_ids: [placed.id], team_id: teams[0]?.id ?? null,
            recorded_by: leader.id, recorded_by_name: leader.name,
            held_at: new Date(Date.now() - w * week - 3 * 86400000).toISOString(), notes: '', attachments: []
          });
        }
      }
    }

    // Vail Daily has practiced every Foundation at least once, so the
    // organization holds The Full Set.
    if (org.slug === 'vd') {
      behaviors.forEach((b, i) => {
        const r = rituals.find((x) => !x.applies_to_all && b.ritualIds.includes(x.id));
        const p = b.placements[0];
        if (!r && !p) return;
        store.iterations.push({
          id: uid(), org_id: org.id, ritual_id: r ? r.id : null, system_category_id: r ? null : p.systemId,
          behavior_ids: [b.id], team_id: teams[i % 2]?.id ?? null,
          recorded_by: leader.id, recorded_by_name: leader.name,
          held_at: new Date(Date.now() - ((i % 9) + 1) * week - 4 * 86400000).toISOString(), notes: '', attachments: []
        });
      });

      // Two finished pulse rounds, the second tighter than the first, and a
      // third under way: a completed cairn with a 2 on it, and Gap Closed.
      if (!store.pulse.some((x) => x.org_id === org.id)) {
        const raters = [champ, leader].filter(Boolean);
        const stamp = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
        behaviors.forEach((b, i) => {
          [[1, [1, 5], 70], [2, [3, 4], 35]].forEach(([round, scores, ago]) => {
            raters.forEach((u, k) => store.pulse.push({
              id: uid(), org_id: org.id, behavior_id: b.id, user_id: u.id,
              score: scores[k % scores.length], round, created_at: stamp(ago)
            }));
          });
          if (i < Math.ceil(behaviors.length * 0.6)) {
            store.pulse.push({ id: uid(), org_id: org.id, behavior_id: b.id, user_id: champ.id,
              score: 4, round: 3, created_at: stamp(3) });
          }
        });
      }
    }

    const member = people.find((u) => u.role === 'member');
    if (member && leader && member.id !== leader.id) {
      const titles = ['Corrected the record before anyone had to ask', 'Held the deadline when it would have been easy to slip'];
      titles.forEach((title, i) => {
        const b = behaviors[i % behaviors.length];
        store.recognitions.unshift({
          id: uid(), org_id: org.id, behavior_id: b.id, author_id: leader.id, author_name: leader.name,
          recipient: member.name, recipient_user_id: member.id, title,
          body: 'Seen it, and it made the week better for everyone around it.',
          created_at: new Date(Date.now() - (i + 1) * 9 * 86400000).toISOString(), attachments: []
        });
      });
      const award = (store.awardTypes[org.id] ?? []).find((a) => a.grantable_to === 'member');
      if (award) {
        store.awardGrants.push({
          id: uid(), org_id: org.id, award_type_id: award.id, recipient_user_id: member.id, team_id: null,
          recipient_name: member.name, granted_by: champ.id, granted_by_name: champ.name,
          citation: 'A season of doing the right thing when nobody was checking.',
          granted_at: new Date(Date.now() - 20 * 86400000).toISOString(), recipients: [member.id]
        });
      }
    }
  }
}

function persist(next = db) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch (e) { console.warn('Local store is full. Older attachments may need clearing.', e); }
}

export function resetLocalData() {
  db = build();
  upgrade(db);
  persist();
}

/* -------------------------------------------------------------------- auth */

function currentUser() {
  return (db.users ?? []).find((u) => u.id === db.sessionUserId) ?? null;
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, org_id: u.org_id, is_super: u.is_super };
}

export async function getSession() {
  const u = currentUser();
  return u ? { user: publicUser(u) } : null;
}

export const ARRIVED_FROM_RESET = false;
export function onPasswordRecovery() { return { unsubscribe() {} }; }

export function onAuthChange() {
  return { data: { subscription: { unsubscribe() {} } } };
}

export async function signIn(email, password) {
  if (!isUsable(db)) { db = build(); upgrade(db); persist(); }
  const u = (db.users ?? []).find((x) => x.email === String(email).trim().toLowerCase());
  const digest = await hash(password ?? '');
  // Same message either way: a sign-in form should not confirm which
  // addresses have accounts.
  if (!u || u.passwordHash !== digest) throw new Error('That email and password do not match an account.');
  if (!u.is_super && !u.org_id) throw new Error('Your account is not attached to an organization yet. Ask your administrator.');

  // A lapsed organization keeps its champion, who is on the free tier, and
  // loses everyone else until the subscription is current again.
  // The champion's seat is the free tier and never lapses; everyone else,
  // admins included, is a paid seat.
  if (!u.is_super && u.role !== 'champion') {
    const org = db.orgs.find((o) => o.id === u.org_id);
    const { lapsed } = planFor(org);
    if (lapsed) throw new Error('Your organization\'s subscription is not current. Ask your culture champion.');
  }
  db.sessionUserId = u.id;
  persist();
  window.dispatchEvent(new Event('local-auth'));
  return publicUser(u);
}

export async function signOut() {
  db.sessionUserId = null;
  persist();
  window.dispatchEvent(new Event('local-auth'));
}

export async function changeOwnPassword(current, next) {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  if (u.passwordHash !== await hash(current)) throw new Error('Current password is wrong.');
  if (!next || next.length < 8) throw new Error('Use at least eight characters.');
  u.passwordHash = await hash(next);
  persist();
}

/* ------------------------------------------- joining: three ways in */

/**
 * Mail the app would send. Hosted mode hands these to the email function; in
 * local mode they collect in an outbox an admin can read, so the wording can
 * be checked without a mail server.
 */
function queueMail(orgId, to, subject, body) {
  db.outbox.unshift({ id: uid(), org_id: orgId, to, subject, body, at: now() });
  db.outbox = db.outbox.slice(0, 50);
}

function welcomeBody(org, user, password) {
  const role = { member: 'member', leader: 'leader', admin: 'admin', champion: 'culture champion' }[user.role] ?? user.role;
  return [
    `${user.name}, welcome to the ${org.name} culture portal.`,
    '',
    `You have been added as a ${role}.`,
    '',
    'Signing in',
    `  Email: ${user.email}`,
    password ? `  Starting password: ${password}` : '  Use the password you chose when you asked for access.',
    '  Change it after your first sign-in.',
    '',
    'What you will find',
    '  Culture home: the purpose, the values, and the behavior being practised this week.',
    '  Clarity: every behavior, with coaching tips, teaching points and discussion questions.',
    '  Cadence: the weekly practice session, the rotation, the rituals and the systems that carry them.',
    '  Connection: recognize someone by name, and add stories of the behaviors happening.',
    '',
    'When you sign in you will be asked to rate a couple of behaviors. It takes about thirty',
    'seconds, and it is how the team sees where the culture is strong and where it is thin.',
    '',
    `— ${org.name}`
  ].join('\n');
}

export async function listOutbox(orgId) {
  return db.outbox.filter((m) => m.org_id === orgId || !orgId);
}

/** Example content is marked until someone edits it or clears it out. */
function exampleContent(orgId) {
  const values = [
    { n: 'Trust', d: 'What is said here is safe here, and what is promised here happens.' },
    { n: 'Candor', d: 'Say the hard thing early, to the person who can act on it.' },
    { n: 'Care', d: 'Full attention, real regard, and a team that is good to be on.' }
  ].map((v, i) => ({ id: uid(), org_id: orgId, name: v.n, description: v.d, position: i, is_example: true }));

  const systems = ['Meetings', 'Onboarding', 'Recognition']
    .map((name, i) => ({ id: uid(), org_id: orgId, name, position: i, is_example: true }));

  const behaviors = [
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
  ];

  const valueId = Object.fromEntries(values.map((v) => [v.name, v.id]));
  const systemId = Object.fromEntries(systems.map((x) => [x.name, x.id]));

  const rows = behaviors.map((b) => ({
    id: uid(), org_id: orgId, number: b.number, title: b.title, description: b.description,
    category: b.category, quick_tip: b.quick_tip, coaching_tips: b.coaching_tips,
    teaching_points: b.teaching_points, questions: b.questions,
    failure_state: b.failure_state, hard_rule: b.hard_rule, is_example: true,
    valueIds: b.values.map((n) => valueId[n]).filter(Boolean), ritualIds: [],
    placements: b.number === 1
      ? [{ id: uid(), systemId: systemId.Meetings, owner: 'Whoever leads the meeting',
           cadence: 'Every meeting', artifact: 'Commitments read back at the open', template: null }]
      : []
  }));

  return { values, systems, behaviors: rows };
}

/**
 * Stands up a new organization with its culture champion and a little example
 * content, so the first sign-in is not an empty screen.
 */
export async function createPortal({ orgName, subtitle, championName, championEmail, password }) {
  const email = String(championEmail).trim().toLowerCase();
  if (!orgName?.trim()) throw new Error('Name the organization.');
  if (!championName?.trim()) throw new Error('Give the culture champion a name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email address does not look right.');
  if (!password || password.length < 8) throw new Error('Choose a password of at least eight characters.');
  if (db.users.some((u) => u.email === email)) throw new Error('That email already has an account. Sign in instead.');

  const orgId = uid();
  const org = {
    id: orgId, slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: orgName.trim(), subtitle: subtitle?.trim() ?? '',
    initials: orgName.trim().slice(0, 2).toUpperCase(), accent: '#9C7A3C',
    vision: 'Write the vision with your team. This line is an example until you change it.',
    mission: 'Write the shared purpose with your team. This line is an example until you change it.',
    creed: 'We name the behavior, practice it weekly, and build it into how we already run.',
    weekly_behavior_id: null, weekly_set_at: now(),
    recent_days: 45, pulse_per_signin: 2, auto_advance: false,
    plan: 'free', billing_cycle: null,
    rate_small_monthly: 49, rate_small_yearly: 490,
    rate_unlimited_monthly: 149, rate_unlimited_yearly: 1490,
    paid_through: null, cancel_at_period_end: false, pending_change: null,
    has_example_content: true
  };
  db.orgs.push(org);

  const seedContent = exampleContent(orgId);
  db.values[orgId] = seedContent.values;
  db.systems[orgId] = seedContent.systems;
  db.behaviors[orgId] = seedContent.behaviors;
  db.rituals[orgId] = [{ id: uid(), org_id: orgId, ...DEFAULT_PRACTICE_RITUAL }];
  db.measures[orgId] = [];
  org.weekly_behavior_id = seedContent.behaviors[0].id;

  const user = {
    id: uid(), email, name: championName.trim(), passwordHash: await hash(password),
    is_super: false, org_id: orgId, role: 'champion'
  };
  db.users.push(user);
  queueMail(orgId, email, `Welcome to the ${org.name} culture portal`, welcomeBody(org, user, null));

  db.sessionUserId = user.id;
  persist();
  window.dispatchEvent(new Event('local-auth'));
  return { org, user };
}

/** Clears everything still marked as an example. */
export async function clearExampleContent(orgId) {
  requireEditor(orgId);
  db.values[orgId] = (db.values[orgId] ?? []).filter((v) => !v.is_example);
  db.systems[orgId] = (db.systems[orgId] ?? []).filter((x) => !x.is_example);
  db.behaviors[orgId] = (db.behaviors[orgId] ?? []).filter((b) => !b.is_example);
  const org = db.orgs.find((o) => o.id === orgId);
  org.has_example_content = false;
  if (!db.behaviors[orgId].some((b) => b.id === org.weekly_behavior_id)) {
    org.weekly_behavior_id = db.behaviors[orgId][0]?.id ?? null;
  }
  persist();
}

/* ------------------------------------------------------- access requests */

export async function listOrganizationNames() {
  return db.orgs.map((o) => ({ id: o.id, name: o.name }));
}

export async function requestAccess({ name, email, orgName, password, note }) {
  const clean = String(email).trim().toLowerCase();
  if (!name?.trim()) throw new Error('Give your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address does not look right.');
  if (!password || password.length < 8) throw new Error('Choose a password of at least eight characters.');
  if (db.users.some((u) => u.email === clean)) throw new Error('That email already has an account. Sign in instead.');

  const org = db.orgs.find((o) => o.name.toLowerCase() === String(orgName).trim().toLowerCase());
  if (!org) throw new Error('We could not find that organization. Check the name with your culture champion.');
  if (db.requests.some((r) => r.email === clean && r.status === 'pending')) {
    throw new Error('You already have a request waiting. Your admin will see it.');
  }

  db.requests.unshift({
    id: uid(), org_id: org.id, name: name.trim(), email: clean,
    passwordHash: await hash(password), note: note?.trim() ?? '',
    status: 'pending', at: now()
  });
  persist();
  return { org: org.name };
}

export async function listAccessRequests(orgId) {
  return db.requests.filter((r) => r.org_id === orgId && r.status === 'pending');
}

/** Approving a request turns it into an account and sends the welcome note. */
export async function approveRequest(requestId, role = 'member') {
  const req = db.requests.find((r) => r.id === requestId);
  if (!req) throw new Error('No such request.');
  const me = requireEditor(req.org_id);
  const org = db.orgs.find((o) => o.id === req.org_id);

  const { effective } = planFor(org);
  const used = db.users.filter((u) => u.org_id === org.id).length;
  if (!me.is_super && used >= effective.seats) {
    throw new Error(effective.free
      ? 'This organization is on the free tier, which covers the culture champion only. Choose a plan to add people.'
      : `That plan covers ${effective.seats} people and ${used} are in use.`);
  }
  if (role === 'champion') throw new Error('Approve them as an admin, then hand over the champion role.');

  const user = {
    id: uid(), email: req.email, name: req.name, passwordHash: req.passwordHash,
    is_super: false, org_id: req.org_id, role
  };
  db.users.push(user);
  req.status = 'approved';
  queueMail(org.id, user.email, `Welcome to the ${org.name} culture portal`, welcomeBody(org, user, null));
  persist();
  return { ok: true, id: user.id, welcome: { sent: true, local: true } };
}

export async function declineRequest(requestId) {
  const req = db.requests.find((r) => r.id === requestId);
  if (!req) return;
  requireEditor(req.org_id);
  req.status = 'declined';
  persist();
}

/* ------------------------------------------------------- password resets */

/**
 * A six digit code, good for thirty minutes and one use. Local mode writes it
 * to the outbox instead of sending mail; hosted mode uses Supabase's own
 * reset email.
 */
export async function requestPasswordReset(email) {
  const clean = String(email).trim().toLowerCase();
  const user = db.users.find((u) => u.email === clean);
  // Same answer either way: a reset form should not reveal who has an account.
  if (user) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.resets = db.resets.filter((r) => r.email !== clean);
    db.resets.push({ email: clean, code, expires: Date.now() + 30 * 60000 });
    queueMail(user.org_id, clean, 'Your culture portal reset code', [
      `${user.name}, here is your reset code: ${code}`,
      '',
      'It works once and expires in thirty minutes.',
      'If you did not ask for it, ignore this message and nothing changes.'
    ].join('\n'));
    persist();
    return { sent: true, code };   // the code is returned only in local mode
  }
  return { sent: true };
}

export async function resetPassword({ email, code, password }) {
  const clean = String(email).trim().toLowerCase();
  const entry = db.resets.find((r) => r.email === clean);
  if (!entry || entry.code !== String(code).trim()) throw new Error('That code is not right.');
  if (entry.expires < Date.now()) throw new Error('That code has expired. Ask for another.');
  if (!password || password.length < 8) throw new Error('Use at least eight characters.');

  const user = db.users.find((u) => u.email === clean);
  user.passwordHash = await hash(password);
  db.resets = db.resets.filter((r) => r.email !== clean);
  persist();
  return true;
}

/* ------------------------------------------------------- orgs and content */

/**
 * A member belongs to exactly one organization and sees only that one.
 * The super user is the single exception: they can open any organization.
 */
export async function listMyOrganizations() {
  const u = currentUser();
  if (!u) return [];
  const mine = u.is_super ? db.orgs : db.orgs.filter((o) => o.id === u.org_id);
  return mine.map((o) => ({
    ...o,
    role: u.is_super ? 'owner' : u.role,
    displayName: u.name,
    isSuper: u.is_super
  }));
}

export async function getOrganization(orgId) {
  return db.orgs.find((o) => o.id === orgId);
}

/* ------------------------------------------------ editing the organization */

export async function updateOrganization(orgId, fields) {
  requireEditor(orgId);
  const org = db.orgs.find((o) => o.id === orgId);
  Object.assign(org, fields);
  persist();
  return org;
}

/** Which behavior the portal is practising right now. */
/**
 * Moves the behavior of the week on when the calendar has, if the
 * organization asked for that. Called whenever its content is loaded, so the
 * rotation advances without anything scheduled.
 */
export async function maybeAdvanceWeekly(orgId) {
  const org = db.orgs.find((o) => o.id === orgId);
  if (!org?.auto_advance) return null;
  const list = (db.behaviors[orgId] ?? []).slice().sort((a, b) => a.number - b.number);
  if (list.length < 2) return null;

  const since = org.weekly_set_at ? Date.now() - new Date(org.weekly_set_at).getTime() : Infinity;
  const weeks = Math.floor(since / (7 * 86400000));
  if (weeks < 1) return null;

  const at = Math.max(0, list.findIndex((b) => b.id === org.weekly_behavior_id));
  const next = list[(at + weeks) % list.length];
  org.weekly_behavior_id = next.id;
  // Step the marker forward by whole weeks, so a missed week does not shift
  // the day the rotation turns over.
  org.weekly_set_at = new Date(new Date(org.weekly_set_at ?? Date.now()).getTime() + weeks * 7 * 86400000).toISOString();
  persist();
  return next.id;
}

export async function setAutoAdvance(orgId, on) {
  requireEditor(orgId);
  const org = db.orgs.find((o) => o.id === orgId);
  org.auto_advance = !!on;
  if (on && !org.weekly_set_at) org.weekly_set_at = now();
  persist();
}

export async function setWeeklyBehavior(orgId, behaviorId) {
  requireEditor(orgId);
  const org = db.orgs.find((o) => o.id === orgId);
  org.weekly_behavior_id = behaviorId;
  org.weekly_set_at = now();   // so Admin can warn when it has gone stale
  persist();
}

/* ------------------------------------------------------------------ billing */
/* Two paid tiers plus a free one. The free tier is the culture champion's own
   access, which never lapses: an organization that stops paying keeps its
   content and its champion, and loses everyone else's sign-in.             */

export const PLANS = {
  free:      { id: 'free', name: 'Champion only', seats: 1, free: true },
  small:     { id: 'small', name: 'Up to 9 people', seats: 9 },
  unlimited: { id: 'unlimited', name: 'Unlimited people', seats: Infinity }
};

export function planFor(org) {
  const plan = PLANS[org?.plan] ?? PLANS.free;
  const lapsed = !plan.free && !isCurrent(org);
  return { plan, lapsed, effective: lapsed ? PLANS.free : plan };
}

/** Current means paid through a date that has not passed. Nothing else. */
function isCurrent(org) {
  if (!org?.paid_through) return false;
  return new Date(org.paid_through).getTime() >= new Date().setHours(0, 0, 0, 0);
}

export async function getBilling(orgId) {
  const org = db.orgs.find((o) => o.id === orgId);
  const { plan, lapsed, effective } = planFor(org);
  const used = db.users.filter((u) => u.org_id === orgId).length;
  return {
    plan: org.plan, cycle: org.billing_cycle, paid_through: org.paid_through,
    current: isCurrent(org), lapsed,
    // Cancelled but still inside the paid period: it expires, it has not lapsed.
    cancel_at_period_end: !!org.cancel_at_period_end,
    expiring: !!org.cancel_at_period_end && isCurrent(org),
    pending_change: org.pending_change ?? null,
    seats_used: used,
    seats_allowed: effective.seats === Infinity ? null : effective.seats,
    rates: {
      small: { monthly: org.rate_small_monthly, yearly: org.rate_small_yearly },
      unlimited: { monthly: org.rate_unlimited_monthly, yearly: org.rate_unlimited_yearly }
    }
  };
}

/** Super user only: what this organization is charged. */
export async function setBillingRates(orgId, rates) {
  const me = currentUser();
  if (!me?.is_super) throw new Error('Only the super user can set rates.');
  Object.assign(db.orgs.find((o) => o.id === orgId), rates);
  persist();
}

/** Super user only: record a payment state by hand. */
export async function setBillingStatus(orgId, { paid_through, plan, billing_cycle, cancel_at_period_end }) {
  const me = currentUser();
  if (!me?.is_super) throw new Error('Only the super user can set payment status.');
  const org = db.orgs.find((o) => o.id === orgId);
  if (paid_through !== undefined) {
    org.paid_through = paid_through || null;
    // Recording a payment is what clears a pending plan change.
    org.pending_change = null;
    logBilling(orgId, 'payment-recorded', { paid_through: org.paid_through, plan: org.plan, cycle: org.billing_cycle });
  }
  if (plan !== undefined) org.plan = plan;
  if (billing_cycle !== undefined) org.billing_cycle = billing_cycle;
  if (cancel_at_period_end !== undefined) org.cancel_at_period_end = !!cancel_at_period_end;
  persist();
}

/**
 * In hosted mode this hands off to Stripe Checkout and the subscription
 * webhook writes the result back. Local mode has no server to talk to, so it
 * simulates a successful subscription and says so.
 */
/**
 * Records the plan an organization has chosen. It does not move the
 * paid-through date: that changes when the super user records a payment, and
 * later when Stripe confirms one. Until then the change shows as pending on
 * both sides.
 */
export async function startCheckout(orgId, { plan, cycle }) {
  const me = requireEditor(orgId);
  const org = db.orgs.find((o) => o.id === orgId);
  const previous = { plan: org.plan, cycle: org.billing_cycle };
  org.plan = plan;
  org.billing_cycle = cycle;
  org.cancel_at_period_end = false;
  org.pending_change = { plan, cycle, at: now(), by: me.name, previous };
  logBilling(orgId, 'plan-selected', { plan, cycle, previous, by: me.name });
  persist();
  return { recorded: true, plan, cycle, paid_through: org.paid_through };
}

function logBilling(orgId, kind, detail) {
  db.billingEvents = db.billingEvents ?? [];
  db.billingEvents.unshift({ id: uid(), org_id: orgId, kind, detail, at: now() });
}

export async function listBillingEvents(orgId) {
  return (db.billingEvents ?? []).filter((e) => e.org_id === orgId).slice(0, 12);
}

/** Cancels at the end of the paid period; access runs to paid_through. */
export async function cancelSubscription(orgId) {
  const me = requireEditor(orgId);
  const org = db.orgs.find((o) => o.id === orgId);
  org.cancel_at_period_end = true;
  logBilling(orgId, 'cancelled', { until: org.paid_through, by: me.name });
  persist();
  return { cancel_at_period_end: true, until: org.paid_through };
}

/** Resuming stops the cancellation. It does not extend the paid period. */
export async function resumeSubscription(orgId) {
  const me = requireEditor(orgId);
  const org = db.orgs.find((o) => o.id === orgId);
  org.cancel_at_period_end = false;
  org.pending_change = { plan: org.plan, cycle: org.billing_cycle, at: now(), by: me.name, resumed: true };
  logBilling(orgId, 'resumed', { plan: org.plan, cycle: org.billing_cycle, by: me.name });
  persist();
  return { resumed: true, paid_through: org.paid_through };
}

/** Every member's email, for prefilling a share. */
export async function listMemberEmails(orgId) {
  return db.users.filter((u) => u.org_id === orgId).map((u) => u.email);
}

export async function setPulseCount(orgId, count) {
  requireEditor(orgId);
  db.orgs.find((o) => o.id === orgId).pulse_per_signin = Math.min(5, Math.max(1, Number(count) || 2));
  persist();
}

export async function setRecentWindow(orgId, days) {
  requireEditor(orgId);
  db.orgs.find((o) => o.id === orgId).recent_days = Number(days) || 45;
  persist();
}

/** Systems and rituals applied to several behaviors at once. */
export async function applySystemToBehaviors(orgId, behaviorIds, placement) {
  requireEditor(orgId);
  for (const bid of behaviorIds) {
    const b = findBehavior(bid);
    if (!b || b.placements.some((p) => p.systemId === placement.systemId)) continue;
    b.placements.push({
      id: uid(), systemId: placement.systemId, owner: placement.owner,
      cadence: placement.cadence, artifact: placement.artifact, template: placement.template || null
    });
  }
  persist();
}

export async function setRitualBehaviors(ritualId, behaviorIds) {
  for (const orgId of Object.keys(db.rituals)) {
    const r = db.rituals[orgId].find((x) => x.id === ritualId);
    if (!r) continue;
    requireEditor(orgId);
    for (const b of db.behaviors[orgId]) {
      const should = behaviorIds.includes(b.id);
      const has = b.ritualIds.includes(ritualId);
      if (should && !has) b.ritualIds.push(ritualId);
      if (!should && has) b.ritualIds = b.ritualIds.filter((id) => id !== ritualId);
    }
    persist();
    return;
  }
}

/** Reordering the rotation renumbers the behaviors; the number is the label. */
export async function reorderBehaviors(orgId, orderedIds) {
  requireEditor(orgId);
  const list = db.behaviors[orgId] ?? [];
  orderedIds.forEach((id, i) => {
    const b = list.find((x) => x.id === id);
    if (b) b.number = i + 1;
  });
  list.sort((a, b) => a.number - b.number);
  persist();
}

/* ----------------------------------------------------------------- values */

export async function createValue(orgId, { name, description }) {
  requireEditor(orgId);
  const row = { id: uid(), org_id: orgId, name, description, position: (db.values[orgId] ?? []).length };
  db.values[orgId] = [...(db.values[orgId] ?? []), row];
  persist();
  return row;
}

export async function updateValue(valueId, fields) {
  for (const orgId of Object.keys(db.values)) {
    const v = db.values[orgId].find((x) => x.id === valueId);
    if (v) { requireEditor(orgId); Object.assign(v, fields); v.is_example = false; persist(); return v; }
  }
  throw new Error('No such value.');
}

export async function deleteValue(valueId) {
  for (const orgId of Object.keys(db.values)) {
    if (db.values[orgId].some((v) => v.id === valueId)) {
      requireEditor(orgId);
      db.values[orgId] = db.values[orgId].filter((v) => v.id !== valueId);
      // A deleted value stops carrying any behavior.
      for (const b of db.behaviors[orgId] ?? []) b.valueIds = b.valueIds.filter((id) => id !== valueId);
      persist();
      return;
    }
  }
}

/* -------------------------------------------------------------- behaviors */

function nextNumber(orgId) {
  const used = (db.behaviors[orgId] ?? []).map((b) => b.number);
  return used.length ? Math.max(...used) + 1 : 1;
}

export async function createBehavior(orgId, fields) {
  requireEditor(orgId);
  const b = {
    id: uid(), org_id: orgId, number: fields.number ?? nextNumber(orgId),
    title: fields.title, description: fields.description, category: fields.category,
    quick_tip: fields.quick_tip ?? '', coaching_tips: fields.coaching_tips ?? [],
    teaching_points: fields.teaching_points ?? [], questions: fields.questions ?? [],
    failure_state: fields.failure_state ?? '', hard_rule: fields.hard_rule ?? '',
    valueIds: fields.valueIds ?? [], ritualIds: [], placements: []
  };
  db.behaviors[orgId] = [...(db.behaviors[orgId] ?? []), b].sort((x, y) => x.number - y.number);
  persist();
  return b;
}

export async function updateBehavior(behaviorId, fields) {
  const b = findBehavior(behaviorId);
  if (!b) throw new Error('No such behavior.');
  requireEditor(b.org_id);
  const { valueIds, ...rest } = fields;
  Object.assign(b, rest);
  b.is_example = false;
  if (valueIds) b.valueIds = valueIds;
  db.behaviors[b.org_id].sort((x, y) => x.number - y.number);
  persist();
  return b;
}

export async function deleteBehavior(behaviorId) {
  const b = findBehavior(behaviorId);
  if (!b) return;
  requireEditor(b.org_id);
  db.behaviors[b.org_id] = db.behaviors[b.org_id].filter((x) => x.id !== behaviorId);
  const org = db.orgs.find((o) => o.id === b.org_id);
  if (org.weekly_behavior_id === behaviorId) org.weekly_behavior_id = db.behaviors[b.org_id][0]?.id ?? null;
  db.stories = db.stories.filter((s) => s.behavior_id !== behaviorId);
  db.recognitions = db.recognitions.filter((r) => r.behavior_id !== behaviorId);
  persist();
}

export async function setBehaviorValues(behaviorId, valueIds) {
  const b = findBehavior(behaviorId);
  requireEditor(b.org_id);
  b.valueIds = valueIds;
  persist();
}

export async function listMembers(orgId) {
  return (db.users ?? [])
    .filter((u) => u.org_id === orgId)
    .map((u) => ({
      id: u.id, user_id: u.id, role: u.role, display_name: u.name, email: u.email,
      team_id: u.team_id ?? null, avatar_url: avatarUrl(u)
    }));
}

/* -------------------------------------------------- administration of users */

/**
 * Admins and the culture champion have the same editing rights. The champion
 * is the single seat that survives a lapsed subscription, so there is only
 * ever one of them.
 */
const EDITOR_ROLES = ['champion', 'admin', 'owner'];

function requireEditor(orgId) {
  const me = currentUser();
  if (!me) throw new Error('Not signed in.');
  if (me.is_super) return me;
  if (me.org_id !== orgId) throw new Error('You can only manage your own organization.');
  if (!EDITOR_ROLES.includes(me.role)) throw new Error('Only an admin or the culture champion can do that.');
  return me;
}

function championOf(orgId) {
  return db.users.find((u) => u.org_id === orgId && u.role === 'champion') ?? null;
}

export async function createUser(orgId, { email, name, role, password, sendWelcome = true }) {
  const me = requireEditor(orgId);
  const clean = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address does not look right.');
  if (db.users.some((u) => u.email === clean)) throw new Error('Someone already uses that email.');
  if (!password || password.length < 8) throw new Error('Set a starting password of at least eight characters.');

  const org = db.orgs.find((o) => o.id === orgId);
  const { effective } = planFor(org);
  const used = db.users.filter((u) => u.org_id === orgId).length;
  if (!me.is_super && used >= effective.seats) {
    throw new Error(effective.free
      ? 'This organization is on the free tier, which covers the culture champion only. Choose a plan to add people.'
      : `That plan covers ${effective.seats} people and ${used} are in use. Move to the unlimited plan to add more.`);
  }
  // Only the super user can mint another super user or an owner.
  if ((role === 'owner') && !me.is_super) throw new Error('Only the super user can assign the owner role.');
  if (role === 'champion' && championOf(orgId)) {
    throw new Error(`${championOf(orgId).name} is already the culture champion. Change their role first, or add this person as an admin.`);
  }

  const user = {
    id: uid(), email: clean, name: name || clean.split('@')[0],
    passwordHash: await hash(password), is_super: false, org_id: orgId, role
  };
  db.users.push(user);
  if (sendWelcome) {
    queueMail(orgId, user.email,
      `Welcome to the ${org.name} culture portal`, welcomeBody(org, user, password));
  }
  persist();
  return {
    ...publicUser(user),
    welcome: sendWelcome ? { sent: true, local: true } : { sent: false, reason: 'not requested' }
  };
}

export async function sendWelcomeEmail(userId) {
  const target = db.users.find((u) => u.id === userId);
  if (!target) throw new Error('No such person.');
  requireEditor(target.org_id);
  const org = db.orgs.find((o) => o.id === target.org_id);
  queueMail(org.id, target.email, `Welcome to the ${org.name} culture portal`, welcomeBody(org, target, null));
  persist();
  return { ok: true, welcome: { sent: true, local: true } };
}

export async function updateUserRole(userId, role) {
  const target = db.users.find((u) => u.id === userId);
  if (!target) throw new Error('No such user.');
  const me = requireEditor(target.org_id);
  if (target.id === me.id && !me.is_super) throw new Error('You cannot change your own role.');
  if (role === 'owner' && !me.is_super) throw new Error('Only the super user can assign the owner role.');
  const existing = championOf(target.org_id);
  if (role === 'champion' && existing && existing.id !== target.id) {
    // Exactly one champion: handing the role over demotes the previous one.
    existing.role = 'admin';
  }
  if (target.role === 'champion' && role !== 'champion' && !me.is_super) {
    throw new Error('An organization needs a culture champion. Give the role to someone else first.');
  }
  target.role = role;
  persist();
}

export async function removeUser(userId) {
  const target = db.users.find((u) => u.id === userId);
  if (!target) return;
  const me = requireEditor(target.org_id);
  if (target.id === me.id) throw new Error('You cannot remove your own account.');
  db.users = db.users.filter((u) => u.id !== userId);
  persist();
}

export async function resetUserPassword(userId, password) {
  const target = db.users.find((u) => u.id === userId);
  if (!target) throw new Error('No such user.');
  requireEditor(target.org_id);
  if (!password || password.length < 8) throw new Error('Use at least eight characters.');
  target.passwordHash = await hash(password);
  persist();
}

/** Super user only: stand up a new client organization. */
export async function createOrganization({ name, subtitle, initials, accent, mission, vision, creed }) {
  const me = currentUser();
  if (!me?.is_super) throw new Error('Only the super user can create an organization.');
  const org = {
    id: uid(), slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name, subtitle: subtitle || '', initials: initials || name.slice(0, 2).toUpperCase(),
    accent: accent || '#9C7A3C', vision: vision || '', mission: mission || '', creed: creed || '',
    weekly_behavior_id: null, weekly_set_at: null,
    recent_days: 45, pulse_per_signin: 2, auto_advance: false,
    plan: 'free', billing_cycle: null,
    rate_small_monthly: 49, rate_small_yearly: 490,
    rate_unlimited_monthly: 149, rate_unlimited_yearly: 1490,
    paid_through: null, cancel_at_period_end: false, pending_change: null
  };
  db.orgs.push(org);
  db.values[org.id] = [];
  db.systems[org.id] = [];
  db.behaviors[org.id] = [];
  // Every new organization starts with the practice session, which applies to
  // every behavior it will go on to write.
  db.rituals[org.id] = [{ id: uid(), org_id: org.id, ...DEFAULT_PRACTICE_RITUAL }];
  persist();
  return org;
}

export async function listAllOrganizations() {
  const me = currentUser();
  if (!me?.is_super) throw new Error('Only the super user can list every organization.');
  return db.orgs.map((o) => ({
    ...o,
    members: db.users.filter((u) => u.org_id === o.id).length,
    behaviors: (db.behaviors[o.id] ?? []).length
  }));
}

export async function listCategories() {
  return [
    { name: 'Character', question: 'Who are we when it costs us?', position: 1 },
    { name: 'Connection', question: 'How do we treat people?', position: 2 },
    { name: 'Craft', question: 'How do we make decisions and do our work?', position: 3 },
    { name: 'Cause', question: 'Who is this for? What impact will we make?', position: 4 },
    { name: 'Change', question: 'How do we adapt, grow, and accept to stay significant?', position: 5 }
  ];
}

export async function listValues(orgId) { return db.values[orgId] ?? []; }
export async function listSystemCategories(orgId) { return db.systems[orgId] ?? []; }

export async function createSystemCategory(orgId, name, position = 99) {
  const row = { id: uid(), org_id: orgId, name, position };
  db.systems[orgId] = [...(db.systems[orgId] ?? []), row];
  persist();
  return row;
}

export async function updateSystemCategory(id, fields) {
  for (const orgId of Object.keys(db.systems)) {
    const c = db.systems[orgId].find((x) => x.id === id);
    if (c) { requireEditor(orgId); Object.assign(c, fields); persist(); return c; }
  }
}

export async function deleteSystemCategory(id) {
  for (const orgId of Object.keys(db.systems)) {
    db.systems[orgId] = db.systems[orgId].filter((s) => s.id !== id);
  }
  persist();
}

export async function listBehaviors(orgId) {
  await maybeAdvanceWeekly(orgId);
  const values = db.values[orgId] ?? [];
  const systems = db.systems[orgId] ?? [];
  const rituals = db.rituals[orgId] ?? [];
  return (db.behaviors[orgId] ?? []).map((b) => ({
    ...b,
    values: b.valueIds.map((id) => values.find((v) => v.id === id)).filter(Boolean),
    rituals: b.ritualIds.map((id) => rituals.find((r) => r.id === id)).filter(Boolean),
    placements: b.placements.map((p) => ({
      ...p, system: systems.find((s) => s.id === p.systemId)?.name
    }))
  }));
}

function findBehavior(behaviorId) {
  for (const orgId of Object.keys(db.behaviors)) {
    const b = db.behaviors[orgId].find((x) => x.id === behaviorId);
    if (b) return b;
  }
  return null;
}

export async function applySystem(orgId, behaviorId, { systemId, owner, cadence, artifact, template }) {
  const b = findBehavior(behaviorId);
  b.placements.push({ id: uid(), systemId, owner, cadence, artifact, template: template || null });
  persist();
}

export async function savePlacementTemplate(placementId, template) {
  for (const orgId of Object.keys(db.behaviors)) {
    for (const b of db.behaviors[orgId]) {
      const p = b.placements.find((x) => x.id === placementId);
      if (p) { p.template = template; persist(); return; }
    }
  }
}

export async function removePlacement(placementId) {
  for (const orgId of Object.keys(db.behaviors)) {
    for (const b of db.behaviors[orgId]) {
      b.placements = b.placements.filter((p) => p.id !== placementId);
    }
  }
  persist();
}

export async function listRituals(orgId) {
  const behaviors = db.behaviors[orgId] ?? [];
  return (db.rituals[orgId] ?? []).map((r) => ({
    ...r,
    behaviors: behaviors.filter((b) => b.ritualIds.includes(r.id))
      .map((b) => ({ id: b.id, number: b.number, title: b.title }))
  }));
}

export async function createRitual(orgId, ritual) {
  requireEditor(orgId);
  const row = { id: uid(), org_id: orgId, ...ritual };
  db.rituals[orgId] = [...(db.rituals[orgId] ?? []), row];
  persist();
  return row;
}

export async function updateRitual(ritualId, fields) {
  for (const orgId of Object.keys(db.rituals)) {
    const r = db.rituals[orgId].find((x) => x.id === ritualId);
    if (r) { requireEditor(orgId); Object.assign(r, fields); persist(); return r; }
  }
  throw new Error('No such ritual.');
}

export async function deleteRitual(ritualId) {
  for (const orgId of Object.keys(db.rituals)) {
    if (db.rituals[orgId].some((r) => r.id === ritualId)) {
      requireEditor(orgId);
      db.rituals[orgId] = db.rituals[orgId].filter((r) => r.id !== ritualId);
      for (const b of db.behaviors[orgId] ?? []) b.ritualIds = b.ritualIds.filter((id) => id !== ritualId);
      persist();
      return;
    }
  }
}

export async function saveRitualPractice(ritualId, practice) {
  for (const orgId of Object.keys(db.rituals)) {
    const r = db.rituals[orgId].find((x) => x.id === ritualId);
    if (r) { r.practice = practice; persist(); return; }
  }
}

export async function applyRitual(behaviorId, ritualId) {
  const b = findBehavior(behaviorId);
  if (!b.ritualIds.includes(ritualId)) b.ritualIds.push(ritualId);
  persist();
}

export async function unapplyRitual(behaviorId, ritualId) {
  const b = findBehavior(behaviorId);
  b.ritualIds = b.ritualIds.filter((id) => id !== ritualId);
  persist();
}

/* -------------------------------------------------------------- iterations */
/* An iteration is one recorded run of a ritual: who ran it, when, and what
   happened. Recency and count on Conviction come from these rows.          */

async function storeFiles(orgId, folder, files = []) {
  const out = [];
  for (const file of files) {
    const path = `${orgId}/${folder}/${file.name}`;
    const row = {
      id: uid(), storage_path: path, file_name: file.name, mime_type: file.type,
      byte_size: file.size, kind: kindOf(file), inline: file.size <= MAX_INLINE_BYTES
    };
    if (row.inline) db.files[path] = await readAsDataUrl(file);
    out.push(row);
  }
  return out;
}

export async function recordIteration(orgId, { ritualId = null, systemId = null, teamId = null, behaviorIds = [], heldAt, notes, files = [], isDraft = false }) {
  const me = currentUser();
  if (!!ritualId === !!systemId) throw new Error('An iteration is a run of one ritual or one system.');
  if (!behaviorIds.length) throw new Error('Pick at least one behavior this covered.');
  if (teamId && !(db.teams[orgId] ?? []).some((t) => t.id === teamId)) throw new Error('That team is not in this organization.');
  const id = uid();
  db.iterations.unshift({
    id, org_id: orgId, ritual_id: ritualId, system_category_id: systemId, team_id: teamId,
    behavior_ids: behaviorIds,
    recorded_by: me?.id ?? null, recorded_by_name: me?.name ?? 'Member',
    held_at: heldAt || now(), notes: notes ?? '', is_draft: !!isDraft,
    attachments: await storeFiles(orgId, `iterations/${id}`, files)
  });
  persist();
  return id;
}

/** The ritual or system an iteration ran, and the behaviors it covered. */
function withSource(it, orgId, full = false) {
  return {
    ...it,
    ritual_id: it.ritual_id ?? null,
    system_category_id: it.system_category_id ?? null,
    team_id: it.team_id ?? null,
    ritual: it.ritual_id ? (db.rituals[orgId] ?? []).find((r) => r.id === it.ritual_id) ?? null : null,
    system: it.system_category_id ? (db.systems[orgId] ?? []).find((s) => s.id === it.system_category_id) ?? null : null,
    behaviors: (db.behaviors[orgId] ?? [])
      .filter((b) => (it.behavior_ids ?? []).includes(b.id))
      .map((b) => full
        ? { id: b.id, number: b.number, title: b.title, description: b.description, category: b.category }
        : { id: b.id, number: b.number, title: b.title })
  };
}

export async function listIterations(orgId, { behaviorId, ritualId, systemId, days } = {}) {
  const cutoff = days ? Date.now() - days * 86400000 : null;
  return db.iterations
    .filter((it) => it.org_id === orgId && visible(it, it.recorded_by))
    .filter((it) => !behaviorId || (it.behavior_ids ?? []).includes(behaviorId))
    .filter((it) => !ritualId || it.ritual_id === ritualId)
    .filter((it) => !systemId || it.system_category_id === systemId)
    .filter((it) => !cutoff || new Date(it.held_at).getTime() >= cutoff)
    .map((it) => withSource(it, orgId))
    .sort((a, b) => b.held_at.localeCompare(a.held_at));
}

export async function getIteration(id) {
  const it = db.iterations.find((x) => x.id === id);
  if (!it || !visible(it, it.recorded_by)) return null;
  const out = withSource(it, it.org_id, true);
  // A system run shows the template it followed, from the first behavior it covered.
  if (out.system) {
    const b = (db.behaviors[it.org_id] ?? []).find((x) => (it.behavior_ids ?? []).includes(x.id)
      && x.placements.some((p) => p.systemId === it.system_category_id));
    const p = b?.placements.find((x) => x.systemId === it.system_category_id);
    out.system = { ...out.system, template: p?.template ?? null, artifact: p?.artifact ?? null,
      owner: p?.owner ?? null, cadence: p?.cadence ?? null };
  }
  return out;
}

export async function deleteIteration(id) {
  const it = db.iterations.find((x) => x.id === id);
  if (!it) return;
  requireModify(it.org_id, it.recorded_by, 'that run');
  for (const a of it.attachments ?? []) delete db.files[a.storage_path];
  db.iterations = db.iterations.filter((x) => x.id !== id);
  persist();
}

/* ------------------------------------------------------------- one story or
   recognition, for its own page                                            */

export async function getStory(id) {
  const s = db.stories.find((x) => x.id === id);
  if (!s || !visible(s, s.author_id)) return null;
  const b = findBehavior(s.behavior_id);
  return { ...s, story_attachments: s.attachments, behavior: b ? { ...b } : null };
}

export async function getRecognition(id) {
  const r = db.recognitions.find((x) => x.id === id);
  if (!r || !visible(r, r.author_id)) return null;
  const b = findBehavior(r.behavior_id);
  return { ...r, behavior: b ? { ...b } : null };
}

export async function getRitual(id) {
  for (const orgId of Object.keys(db.rituals)) {
    const r = db.rituals[orgId].find((x) => x.id === id);
    if (r) {
      return {
        ...r,
        behaviors: (db.behaviors[orgId] ?? [])
          .filter((b) => r.applies_to_all || b.ritualIds.includes(r.id))
          .map((b) => ({ id: b.id, number: b.number, title: b.title }))
      };
    }
  }
  return null;
}

/* ---------------------------------------------------------------- measures */
/* Definitions are set once by an administrator; values are recorded per
   period, so the two jobs stay separate.                                   */

export async function listMeasures(orgId) {
  return (db.measures[orgId] ?? []).slice().sort((a, b) => a.position - b.position);
}

export async function createMeasure(orgId, { name, note }) {
  requireEditor(orgId);
  const row = { id: uid(), org_id: orgId, name, note: note ?? '', position: (db.measures[orgId] ?? []).length };
  db.measures[orgId] = [...(db.measures[orgId] ?? []), row];
  persist();
  return row;
}

export async function updateMeasure(measureId, fields) {
  for (const orgId of Object.keys(db.measures)) {
    const m = db.measures[orgId].find((x) => x.id === measureId);
    if (m) { requireEditor(orgId); Object.assign(m, fields); persist(); return m; }
  }
}

export async function deleteMeasure(measureId) {
  for (const orgId of Object.keys(db.measures)) {
    if (db.measures[orgId].some((m) => m.id === measureId)) {
      requireEditor(orgId);
      db.measures[orgId] = db.measures[orgId].filter((m) => m.id !== measureId);
      for (const e of db.measureEntries) delete e.values[measureId];
      persist();
      return;
    }
  }
}

export async function listMeasureEntries(orgId) {
  return db.measureEntries
    .filter((e) => e.org_id === orgId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

export async function recordMeasureEntry(orgId, { period, values }) {
  const me = currentUser();
  db.measureEntries.unshift({
    id: uid(), org_id: orgId, period, values,
    recorded_at: now(), recorded_by_name: me?.name ?? 'Member'
  });
  persist();
}

/* ------------------------------------------------------------------- pulse */
/* Two behaviors per sign-in, rotating through the list, until each behavior
   has been scored by a quarter of the organization. Then a new round opens. */

function pulseTarget(orgId) {
  const members = db.users.filter((u) => u.org_id === orgId).length || 1;
  return Math.max(1, Math.ceil(members * 0.25));
}

function currentRound(orgId) {
  const rounds = db.pulse.filter((p) => p.org_id === orgId).map((p) => p.round ?? 1);
  const round = rounds.length ? Math.max(...rounds) : 1;
  const behaviors = (db.behaviors[orgId] ?? []).filter((b) => !b.is_example);
  const target = pulseTarget(orgId);
  const complete = behaviors.length > 0 && behaviors.every((b) =>
    db.pulse.filter((p) => p.behavior_id === b.id && (p.round ?? 1) === round).length >= target);
  return complete ? round + 1 : round;
}

/** The two behaviors to put in front of this person right now, or none. */
export async function getPulseAssignment(orgId) {
  const me = currentUser();
  if (!me) return { behaviors: [], round: 1, target: 0 };
  const perSignin = db.orgs.find((o) => o.id === orgId)?.pulse_per_signin ?? 2;
  const round = currentRound(orgId);
  const target = pulseTarget(orgId);
  const mine = new Set(db.pulse
    .filter((p) => p.org_id === orgId && (p.round ?? 1) === round && p.user_id === me.id)
    .map((p) => p.behavior_id));

  const counts = (id) => db.pulse.filter((p) => p.behavior_id === id && (p.round ?? 1) === round).length;
  // Example content is not worth rating, and a portal with nothing real in it
  // is not ready to be asked.
  const real = (db.behaviors[orgId] ?? []).filter((b) => !b.is_example);
  if (!real.length) return { behaviors: [], round, target, waiting: true };

  const candidates = real
    .filter((b) => !mine.has(b.id) && counts(b.id) < target)
    .sort((a, b) => counts(a.id) - counts(b.id) || a.number - b.number)
    .slice(0, perSignin)
    .map((b) => ({ id: b.id, number: b.number, title: b.title, description: b.description, category: b.category }));

  return { behaviors: candidates, round, target };
}

export async function submitPulse(orgId, answers) {
  const me = currentUser();
  const round = currentRound(orgId);
  for (const [behavior_id, score] of Object.entries(answers)) {
    db.pulse = db.pulse.filter((p) =>
      !(p.behavior_id === behavior_id && p.user_id === me?.id && (p.round ?? 1) === round));
    db.pulse.push({
      id: uid(), org_id: orgId, behavior_id, user_id: me?.id ?? null,
      score: Number(score), round, created_at: now()
    });
  }
  persist();
}

export async function getPulseStatus(orgId) {
  const round = currentRound(orgId);
  const target = pulseTarget(orgId);
  const behaviors = (db.behaviors[orgId] ?? []).filter((b) => !b.is_example);
  const scored = behaviors.filter((b) =>
    db.pulse.filter((p) => p.behavior_id === b.id && (p.round ?? 1) === round).length >= target).length;
  return { round, target, scored, total: behaviors.length };
}

/* ----------------------------------------------------------------- stories */

function withBehavior(row, orgId) {
  const b = (db.behaviors[orgId] ?? []).find((x) => x.id === row.behavior_id);
  return { ...row, behaviors: b ? { id: b.id, number: b.number, title: b.title } : null };
}

export async function listStories(orgId, { behaviorId } = {}) {
  return db.stories
    .filter((s) => s.org_id === orgId && (!behaviorId || s.behavior_id === behaviorId) && visible(s, s.author_id))
    .map((s) => ({ ...withBehavior(s, orgId), story_attachments: s.attachments }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}

function kindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

export async function createStory(orgId, { behaviorId, body, authorName, files = [], isDraft = false }) {
  const story = {
    id: uid(), org_id: orgId, behavior_id: behaviorId, author_id: currentUser()?.id ?? null,
    author_name: authorName || currentUser()?.name || 'Member',
    body, created_at: now(), attachments: [], is_draft: !!isDraft
  };

  for (const file of files) {
    const path = `${orgId}/${story.id}/${file.name}`;
    const attachment = {
      id: uid(), story_id: story.id, storage_path: path, file_name: file.name,
      mime_type: file.type, byte_size: file.size, kind: kindOf(file),
      inline: file.size <= MAX_INLINE_BYTES
    };
    if (attachment.inline) db.files[path] = await readAsDataUrl(file);
    story.attachments.push(attachment);
  }

  db.stories.unshift(story);
  persist();
  return story;
}

export async function deleteStory(id) {
  const st = db.stories.find((x) => x.id === id);
  if (!st) return;
  const me = currentUser();
  if (me?.id !== st.author_id && !(me?.is_super || (me?.org_id === st.org_id && EDITOR_ROLES.includes(me?.role))))
    throw new Error('Only the author or an admin can delete that.');
  for (const a of st.attachments ?? []) delete db.files[a.storage_path];
  db.stories = db.stories.filter((x) => x.id !== id);
  persist();
}

export async function deleteRecognition(id) {
  const r = db.recognitions.find((x) => x.id === id);
  if (!r) return;
  const me = currentUser();
  if (me?.id !== r.author_id && !(me?.is_super || (me?.org_id === r.org_id && EDITOR_ROLES.includes(me?.role))))
    throw new Error('Only the author or an admin can delete that.');
  for (const a of r.attachments ?? []) delete db.files[a.storage_path];
  db.recognitions = db.recognitions.filter((x) => x.id !== id);
  persist();
}

export async function signAttachment(path) {
  return db.files[path] ?? null;
}

/**
 * No server to send from, so this opens the user's own mail client with the
 * story already written. Attachments are named rather than embedded; the
 * hosted version signs real links instead.
 */
export async function shareStoryByEmail(storyId, recipients, note) {
  const story = db.stories.find((s) => s.id === storyId);
  const b = findBehavior(story.behavior_id);
  const org = db.orgs.find((o) => o.id === story.org_id);
  const num = String(b.number).padStart(2, '0');

  const lines = [
    note ? note + '\n' : '',
    `${num}. ${b.title}`,
    b.description,
    '',
    `${story.author_name}: ${story.body}`,
    story.attachments.length
      ? '\nAttachments (shared separately in local mode): ' + story.attachments.map((a) => a.file_name).join(', ')
      : '',
    `\n— ${org.name} culture portal`
  ].filter(Boolean).join('\n');

  const to = Array.isArray(recipients) ? recipients.join(',') : recipients;
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`${org.name}: ${num}. ${b.title}`)}&body=${encodeURIComponent(lines)}`;
  allowLeave(); window.open(href, '_self');

  db.shares.push({ id: uid(), story_id: storyId, recipients: to.split(/[,;\s]+/).filter(Boolean), note, sent_at: now() });
  persist();
  return { sent: to.split(/[,;\s]+/).filter(Boolean).length, mode: 'mailto' };
}

/* ------------------------------------------------------------- recognition */

export async function listRecognitions(orgId, { behaviorId } = {}) {
  return db.recognitions
    .filter((r) => r.org_id === orgId && (!behaviorId || r.behavior_id === behaviorId) && visible(r, r.author_id))
    .map((r) => ({ ...withBehavior(r, orgId), attachments: r.attachments ?? [] }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createRecognition(orgId, { behaviorId, recipient, recipientUserId = null, title = null, body, authorName, files = [], isDraft = false }) {
  const me = currentUser();
  if (recipientUserId) {
    const target = db.users.find((u) => u.id === recipientUserId);
    if (!target || target.org_id !== orgId) throw new Error('That person is not in this organization.');
    if (target.id === me?.id) throw new Error('Recognition goes to someone else.');
    recipient = target.name;
  }
  const id = uid();
  db.recognitions.unshift({
    id, org_id: orgId, behavior_id: behaviorId, recipient, recipient_user_id: recipientUserId,
    title: title || null, body, author_id: me?.id ?? null,
    author_name: authorName || me?.name || 'Member', created_at: now(), is_draft: !!isDraft,
    attachments: await storeFiles(orgId, `recognitions/${id}`, files)
  });
  persist();
}

/* ------------------------------------------------------------- measurement */

/** Real responses only. No responses means no score, which is the honest state. */
export async function getPulse(orgId) {
  return (db.behaviors[orgId] ?? []).map((b) => {
    const own = db.pulse.filter((p) => p.behavior_id === b.id);
    if (!own.length) {
      return { behavior_id: b.id, org_id: orgId, number: b.number, title: b.title,
        avg_score: null, spread: null, responses: 0 };
    }
    const avg = own.reduce((t, p) => t + p.score, 0) / own.length;
    const variance = own.reduce((t, p) => t + (p.score - avg) ** 2, 0) / Math.max(1, own.length - 1);
    return { behavior_id: b.id, org_id: orgId, number: b.number, title: b.title,
      avg_score: avg.toFixed(2), spread: Math.sqrt(variance).toFixed(2), responses: own.length };
  });
}

export async function getCoverage(orgId) {
  return (db.behaviors[orgId] ?? []).map((b) => {
    const runs = db.iterations.filter((it) => (it.behavior_ids ?? []).includes(b.id));
    const last = runs.map((it) => it.held_at).sort().pop() ?? null;
    return {
      behavior_id: b.id, org_id: orgId, number: b.number, title: b.title,
      systems: b.placements.map((p) => (db.systems[orgId] ?? []).find((s) => s.id === p.systemId)?.name).filter(Boolean),
      placement_count: b.placements.length,
      template_count: b.placements.filter((p) => p.template).length,
      ritual_count: b.ritualIds.length,
      iteration_count: runs.length,
      last_run: last,
      is_gap: b.placements.length < 2
    };
  });
}



/* ================================================================== R1 */

const LEAD_ROLES = ['leader', 'admin', 'champion', 'owner'];

function requireLeader(orgId) {
  const me = currentUser();
  if (!me) throw new Error('Not signed in.');
  if (me.is_super) return me;
  if (me.org_id !== orgId || !LEAD_ROLES.includes(me.role)) throw new Error('Only a leader can do that.');
  return me;
}

function avatarUrl(u) {
  return u?.avatar_path ? db.files[u.avatar_path] ?? null : null;
}

/* ----------------------------------------------------------------- people */

/** Everyone who can appear on this organization's pages, with team and picture. */
export async function listPeople(orgId) {
  return db.users
    .filter((u) => u.org_id === orgId || u.is_super)
    .map((u) => ({
      user_id: u.id, display_name: u.name, role: u.is_super ? 'owner' : u.role,
      team_id: u.is_super ? null : u.team_id ?? null, avatar_url: avatarUrl(u), in_org: !u.is_super
    }));
}

/** The file arrives already cropped and shrunk by the profile dialog. */
export async function uploadMyAvatar(orgId, file) {
  const me = currentUser();
  if (!me) throw new Error('Not signed in.');
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture file.');
  const path = `${orgId}/${me.id}/avatar`;
  db.files[path] = await readAsDataUrl(file);
  me.avatar_path = path;
  persist();
  return db.files[path];
}

export async function removeMyAvatar() {
  const me = currentUser();
  if (!me) return;
  if (me.avatar_path) delete db.files[me.avatar_path];
  me.avatar_path = null;
  persist();
}

/* ------------------------------------------------------------------ teams */

export async function listTeams(orgId) {
  return (db.teams[orgId] ?? []).filter((t) => !t.archived)
    .slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTeam(orgId, name) {
  requireEditor(orgId);
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('Name the team.');
  db.teams[orgId] = db.teams[orgId] ?? [];
  if (db.teams[orgId].some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`There is already a team called ${clean}.`);
  }
  const team = { id: uid(), org_id: orgId, name: clean, archived: false, created_at: now() };
  db.teams[orgId].push(team);
  persist();
  return team;
}

export async function renameTeam(teamId, name) {
  for (const orgId of Object.keys(db.teams)) {
    const t = db.teams[orgId].find((x) => x.id === teamId);
    if (t) { requireEditor(orgId); t.name = String(name).trim(); persist(); return t; }
  }
  throw new Error('No such team.');
}

export async function setMemberTeam(orgId, userId, teamId) {
  requireEditor(orgId);
  const u = db.users.find((x) => x.id === userId && x.org_id === orgId);
  if (!u) throw new Error('No such person in this organization.');
  if (teamId && !(db.teams[orgId] ?? []).some((t) => t.id === teamId)) throw new Error('No such team.');
  u.team_id = teamId || null;
  persist();
}

/* ----------------------------------------------------------- value awards */

export async function listAwardTypes(orgId) {
  return (db.awardTypes[orgId] ?? []).map((a) => ({ ...a, valueIds: a.valueIds ?? [] }));
}

export async function saveAwardType(orgId, fields) {
  requireEditor(orgId);
  const clean = {
    name: String(fields.name ?? '').trim(),
    description: fields.description?.trim() || null,
    grantable_to: fields.grantable_to ?? 'both',
    grant_cap: fields.grant_cap ? Number(fields.grant_cap) : null,
    cap_period: fields.grant_cap ? fields.cap_period ?? 'quarter' : null,
    active: fields.active ?? true,
    valueIds: fields.valueIds ?? []
  };
  if (!clean.name) throw new Error('Name the award.');
  if (!clean.valueIds.length) throw new Error('Pick at least one Value this award stands for.');
  db.awardTypes[orgId] = db.awardTypes[orgId] ?? [];
  if (fields.id) {
    const a = db.awardTypes[orgId].find((x) => x.id === fields.id);
    if (!a) throw new Error('No such award.');
    Object.assign(a, clean);
    persist();
    return a;
  }
  const a = { id: uid(), org_id: orgId, created_at: now(), ...clean };
  db.awardTypes[orgId].push(a);
  persist();
  return a;
}

export async function listAwardGrants(orgId) {
  const types = db.awardTypes[orgId] ?? [];
  return db.awardGrants
    .filter((g) => g.org_id === orgId && visible(g, g.granted_by))
    .map((g) => ({ ...g, attachments: g.attachments ?? [], award: types.find((t) => t.id === g.award_type_id) ?? null }))
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}

function periodStart(period) {
  const d = new Date();
  if (period === 'year') return new Date(d.getFullYear(), 0, 1);
  if (period === 'quarter') return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function grantAward(orgId, { awardTypeId, recipientUserId = null, teamId = null, citation, files = [], isDraft = false }) {
  const me = requireLeader(orgId);
  const t = (db.awardTypes[orgId] ?? []).find((x) => x.id === awardTypeId);
  if (!t || !t.active) throw new Error('That award is not available.');
  if (!!recipientUserId === !!teamId) throw new Error('An award goes to one person or one team.');
  if (t.grantable_to === 'member' && teamId) throw new Error(`${t.name} goes to a person, not a team.`);
  if (t.grantable_to === 'team' && recipientUserId) throw new Error(`${t.name} goes to a team, not a person.`);
  if (recipientUserId === me.id) throw new Error('A Value award goes to someone else.');
  if (!String(citation ?? '').trim()) throw new Error('Write the citation: what they did.');
  if (!isDraft) checkAwardCap(t, me.id);
  let recipient_name, recipients;
  if (teamId) {
    const team = (db.teams[orgId] ?? []).find((x) => x.id === teamId);
    if (!team) throw new Error('No such team.');
    recipient_name = team.name;
    recipients = db.users.filter((u) => u.org_id === orgId && u.team_id === teamId).map((u) => u.id);
  } else {
    const u = db.users.find((x) => x.id === recipientUserId && x.org_id === orgId);
    if (!u) throw new Error('That person is not in this organization.');
    recipient_name = u.name;
    recipients = [u.id];
  }
  const id = uid();
  const g = {
    id, org_id: orgId, award_type_id: t.id, recipient_user_id: recipientUserId, team_id: teamId,
    recipient_name, granted_by: me.id, granted_by_name: me.name, citation: citation.trim(),
    granted_at: now(), recipients, attachments: await storeFiles(orgId, `awards/${id}`, files), is_draft: !!isDraft
  };
  db.awardGrants.push(g);
  persist();
  return g;
}

/* ---------------------------------------------------------------- fluency */

export async function listMyFluencyMarks(orgId) {
  const me = currentUser();
  return db.fluencyMarks.filter((m) => m.user_id === me?.id && m.org_id === orgId);
}

export async function markFluency(orgId, behaviorId, step) {
  const me = currentUser();
  if (!me) return;
  if (db.fluencyMarks.some((m) => m.user_id === me.id && m.behavior_id === behaviorId && m.step === step)) return;
  db.fluencyMarks.push({ user_id: me.id, behavior_id: behaviorId, org_id: orgId, step, marked_at: now() });
  persist();
}

/* ---------------------------------------------------------- pulse history */

export async function getPulseSpreadByRound(orgId) {
  const rows = db.pulse.filter((p) => p.org_id === orgId);
  const rounds = [...new Set(rows.map((p) => p.round ?? 1))].sort((a, b) => a - b);
  return rounds.map((round) => {
    const inRound = rows.filter((p) => (p.round ?? 1) === round);
    const byBehavior = {};
    for (const p of inRound) (byBehavior[p.behavior_id] ??= []).push(p.score);
    const sds = Object.values(byBehavior).map((xs) => {
      if (xs.length < 2) return 0;
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    });
    const spread = sds.length ? sds.reduce((a, b) => a + b, 0) / sds.length : 0;
    return { round, spread: Math.round(spread * 1000) / 1000, responses: inRound.length };
  });
}


/* ------------------------------------------------ sharing by email, R2 */

/** Opens the person's own mail client; hosted mode sends a formatted email. */
function openMail(to, subject, lines) {
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`;
  allowLeave(); window.open(href, '_self');
  return { sent: to.split(/[,;\s]+/).filter(Boolean).length, mode: 'mailto' };
}

export async function shareRecognitionByEmail(recognitionId, recipients, note) {
  const r = db.recognitions.find((x) => x.id === recognitionId);
  if (!r) throw new Error('That recognition is no longer here.');
  const b = findBehavior(r.behavior_id);
  const org = db.orgs.find((o) => o.id === r.org_id);
  const num = String(b.number).padStart(2, '0');
  const to = Array.isArray(recipients) ? recipients.join(',') : recipients;
  return openMail(to, `${org.name}: ${r.author_name} recognized ${r.recipient}`, [
    note ? note + '\n' : '',
    `${r.author_name} recognized ${r.recipient}${r.title ? `: ${r.title}` : ''}`,
    `${num}. ${b.title}`, b.description, '', r.body,
    (r.attachments ?? []).length ? '\nAttachments (shared separately in local mode): ' + r.attachments.map((a) => a.file_name).join(', ') : '',
    `\n— ${org.name} culture portal`
  ]);
}

export async function shareAwardByEmail(grantId, recipients, note) {
  const g = db.awardGrants.find((x) => x.id === grantId);
  if (!g) throw new Error('That award is no longer here.');
  const org = db.orgs.find((o) => o.id === g.org_id);
  const t = (db.awardTypes[g.org_id] ?? []).find((x) => x.id === g.award_type_id);
  const vals = (t?.valueIds ?? []).map((id) => (db.values[g.org_id] ?? []).find((v) => v.id === id)?.name).filter(Boolean);
  const to = Array.isArray(recipients) ? recipients.join(',') : recipients;
  return openMail(to, `${org.name}: ${t?.name ?? 'Value award'} for ${g.recipient_name}`, [
    note ? note + '\n' : '',
    `${t?.name ?? 'Value award'} conferred on ${g.recipient_name} by ${g.granted_by_name}`,
    vals.length ? `For living ${vals.join(', ')}` : '', '', g.citation,
    (g.attachments ?? []).length ? '\nAttachments (shared separately in local mode): ' + g.attachments.map((a) => a.file_name).join(', ') : '',
    `\n— ${org.name} culture portal`
  ]);
}


/* ================================================================== R3 */
/* Drafts, and who may change or remove a record. The hosted database
   enforces the same rules in row level security and a trigger.            */

/** A draft is visible only to the person who wrote it. */
function visible(row, ownerId) {
  return !row.is_draft || ownerId === currentUser()?.id;
}

function canModifyLocal(orgId, ownerId) {
  const me = currentUser();
  if (!me) return false;
  if (ownerId && me.id === ownerId) return true;
  return !!me.is_super || (me.org_id === orgId && EDITOR_ROLES.includes(me.role));
}

function requireModify(orgId, ownerId, what = 'that') {
  if (!canModifyLocal(orgId, ownerId)) {
    throw new Error(`Only the person who made ${what}, the culture champion or an admin can change it.`);
  }
}

/** Publishing is one way; it stamps the time so the record reads as new. */
function applyDraft(row, isDraft, stampField) {
  if (isDraft === undefined) return;
  if (!row.is_draft && isDraft) throw new Error('A published record cannot go back to draft.');
  if (row.is_draft && !isDraft && stampField) row[stampField] = now();
  row.is_draft = !!isDraft;
}

async function editFiles(row, orgId, folder, addFiles = [], removeFileIds = []) {
  const keep = (row.attachments ?? []).filter((a) => {
    if (!removeFileIds.includes(a.id)) return true;
    delete db.files[a.storage_path];
    return false;
  });
  row.attachments = [...keep, ...(await storeFiles(orgId, folder, addFiles))];
}

function checkAwardCap(t, giverId, exceptId = null) {
  if (!t.grant_cap || !t.cap_period) return;
  const since = periodStart(t.cap_period).toISOString();
  const used = db.awardGrants.filter((g) => g.award_type_id === t.id && g.granted_by === giverId
    && !g.is_draft && g.id !== exceptId && g.granted_at >= since).length;
  if (used >= t.grant_cap) throw new Error(`You have given ${used} ${t.name} this ${t.cap_period}, the limit for this award.`);
}

export async function updateStory(id, { behaviorId, body, isDraft, addFiles = [], removeFileIds = [] }) {
  const st = db.stories.find((x) => x.id === id);
  if (!st || !visible(st, st.author_id)) throw new Error('That story is no longer here.');
  requireModify(st.org_id, st.author_id, 'that story');
  if (behaviorId !== undefined) st.behavior_id = behaviorId;
  if (body !== undefined) st.body = body;
  applyDraft(st, isDraft, 'created_at');
  await editFiles(st, st.org_id, st.id, addFiles, removeFileIds);
  st.updated_at = now();
  persist();
  return st;
}

export async function updateRecognition(id, { behaviorId, recipientUserId, title, body, isDraft, addFiles = [], removeFileIds = [] }) {
  const r = db.recognitions.find((x) => x.id === id);
  if (!r || !visible(r, r.author_id)) throw new Error('That recognition is no longer here.');
  requireModify(r.org_id, r.author_id, 'that recognition');
  if (recipientUserId !== undefined && recipientUserId !== r.recipient_user_id) {
    const target = db.users.find((u) => u.id === recipientUserId);
    if (!target || target.org_id !== r.org_id) throw new Error('That person is not in this organization.');
    if (target.id === r.author_id) throw new Error('Recognition goes to someone else.');
    r.recipient_user_id = target.id;
    r.recipient = target.name;
  }
  if (behaviorId !== undefined) r.behavior_id = behaviorId;
  if (title !== undefined) r.title = title || null;
  if (body !== undefined) r.body = body;
  applyDraft(r, isDraft, 'created_at');
  await editFiles(r, r.org_id, `recognitions/${r.id}`, addFiles, removeFileIds);
  r.updated_at = now();
  persist();
  return r;
}

export async function updateIteration(id, { behaviorIds, teamId, heldAt, notes, isDraft, addFiles = [], removeFileIds = [] }) {
  const it = db.iterations.find((x) => x.id === id);
  if (!it || !visible(it, it.recorded_by)) throw new Error('That run is no longer here.');
  requireModify(it.org_id, it.recorded_by, 'that run');
  if (behaviorIds !== undefined) {
    if (!behaviorIds.length) throw new Error('Pick at least one behavior this covered.');
    it.behavior_ids = behaviorIds;
  }
  if (teamId !== undefined) {
    if (teamId && !(db.teams[it.org_id] ?? []).some((t) => t.id === teamId)) throw new Error('That team is not in this organization.');
    it.team_id = teamId || null;
  }
  if (heldAt !== undefined) it.held_at = heldAt;
  if (notes !== undefined) it.notes = notes;
  applyDraft(it, isDraft, null);
  await editFiles(it, it.org_id, `iterations/${it.id}`, addFiles, removeFileIds);
  it.updated_at = now();
  persist();
  return it;
}

export async function updateAwardGrant(id, { citation, isDraft, addFiles = [], removeFileIds = [] }) {
  const g = db.awardGrants.find((x) => x.id === id);
  if (!g || !visible(g, g.granted_by)) throw new Error('That award is no longer here.');
  requireModify(g.org_id, g.granted_by, 'that award');
  if (citation !== undefined) {
    if (!String(citation).trim()) throw new Error('Write the citation: what they did.');
    g.citation = citation.trim();
  }
  if (g.is_draft && isDraft === false) {
    const t = (db.awardTypes[g.org_id] ?? []).find((x) => x.id === g.award_type_id);
    if (!t || !t.active) throw new Error('That award is retired.');
    checkAwardCap(t, g.granted_by, g.id);
    if (g.team_id) g.recipients = db.users.filter((u) => u.org_id === g.org_id && u.team_id === g.team_id).map((u) => u.id);
  }
  applyDraft(g, isDraft, 'granted_at');
  await editFiles(g, g.org_id, `awards/${g.id}`, addFiles, removeFileIds);
  g.updated_at = now();
  persist();
  return g;
}

export async function deleteAwardGrant(id) {
  const g = db.awardGrants.find((x) => x.id === id);
  if (!g) return;
  requireModify(g.org_id, g.granted_by, 'that award');
  for (const a of g.attachments ?? []) delete db.files[a.storage_path];
  db.awardGrants = db.awardGrants.filter((x) => x.id !== id);
  persist();
}

/** A mailto link is not leaving the portal; let it through the unload check. */
function allowLeave() {
  window.__cpAllowUnload = true;
  setTimeout(() => { window.__cpAllowUnload = false; }, 1500);
}
