import { createClient } from '@supabase/supabase-js';
import { accessState } from './billing.js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Did this page load come from a password reset email? Worked out here, before
 * the client below is created, because the client removes the reset tokens
 * from the address bar as soon as it has read them.
 */
export const ARRIVED_FROM_RESET = typeof window !== 'undefined' &&
  /type=recovery|[?&]reset=1/.test(window.location.search + window.location.hash);

/** Null when the app is running in local mode; api.js routes around it. */
export const supabase = URL && KEY
  ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

/* ------------------------------------------------------------------ session */

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password
  });
  // Supabase already returns one message for a wrong password and an unknown
  // address, which is what we want a sign-in form to say.
  if (error) throw new Error('That email and password do not match an account.');
  return data.user;
}

/**
 * Supabase would change the password on the session alone, so someone at an
 * unlocked screen could take the account. Signing in again with the current
 * password proves it first, goes through Supabase's own rate limit, and gives
 * a fresh session, which "Secure password change" in the project settings wants.
 */
export async function changeOwnPassword(current, next) {
  if (!next || next.length < 8) throw new Error('Use at least eight characters.');
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email;
  if (!email) throw new Error('Not signed in.');

  const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: current ?? '' });
  if (wrong) throw new Error('Current password is wrong.');

  const { error } = await supabase.auth.updateUser({ password: next });
  if (!error) return;
  if (error.code === 'same_password') throw new Error('Choose a password different from the current one.');
  if (error.code === 'weak_password') throw new Error(`That password is too weak. ${error.message}`);
  throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* ------------------------------------------------------- organizations, roles */

/**
 * A person belongs to exactly one organization (memberships has a unique
 * constraint on user_id), so this normally returns a single row. The super
 * user is the exception and sees every organization.
 */
export async function listMyOrganizations() {
  const { data: isSuper } = await supabase.rpc('is_platform_admin');

  if (isSuper) {
    const { data, error } = await supabase.from('organizations').select('*').order('name');
    if (error) throw error;
    return data.map((o) => ({ ...o, role: 'owner', displayName: 'Super Admin', isSuper: true }));
  }

  // Everyone can read every membership in their organization (Admin lists the
  // people), so this must ask for the signed-in person's own row by id.
  // Without the filter it returned whichever member came back first, with
  // that person's name and role.
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('memberships')
    .select('role, display_name, organizations(*)')
    .eq('user_id', userId)
    .limit(1);
  if (error) throw error;
  if (!data.length) {
    // A member of an organization whose plan has lapsed reads nothing, by
    // design. Say why instead of "not attached to an organization".
    const { data: paused } = await supabase.rpc('my_paused_org');
    if (paused?.inactive) {
      throw new Error(`Your account is inactive because ${paused.org_name}'s plan covers fewer people. Ask your culture champion${paused.champion ? `, ${paused.champion}` : ''}.`);
    }
    if (paused?.org_name) {
      throw new Error(`${paused.org_name}'s culture portal is paused, so only its culture champion` +
        `${paused.champion ? `, ${paused.champion},` : ''} can sign in right now. Nothing has been deleted; ask them to bring the plan up to date.`);
    }
  }
  return data.map((m) => ({ ...m.organizations, role: m.role, displayName: m.display_name, isSuper: false }));
}

export async function getOrganization(orgId) {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateOrganization(orgId, fields) {
  const { data, error } = await supabase
    .from('organizations').update(fields).eq('id', orgId).select().single();
  if (error) throw error;
  return data;
}

export async function setWeeklyBehavior(orgId, behaviorId) {
  const { error } = await supabase
    .from('organizations').update({ weekly_behavior_id: behaviorId }).eq('id', orgId);
  if (error) throw error;
}



/* ----------------------------------------------------------------- values */

export async function createValue(orgId, { name, description, category = null, position = 99 }) {
  const { data, error } = await supabase
    .from('values_').insert({ org_id: orgId, name, description, category, position }).select().single();
  if (error) throw error;
  return data;
}

export async function updateValue(valueId, fields) {
  const { data, error } = await supabase
    .from('values_').update(fields).eq('id', valueId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteValue(valueId) {
  const { error } = await supabase.from('values_').delete().eq('id', valueId);
  if (error) throw error;
}

/* -------------------------------------------------------------- behaviors */

export async function createBehavior(orgId, fields) {
  const { valueIds = [], ...rest } = fields;
  const { data, error } = await supabase
    .from('behaviors').insert({ org_id: orgId, ...rest }).select().single();
  if (error) throw error;
  if (valueIds.length) await setBehaviorValues(data.id, valueIds);
  return data;
}

export async function updateBehavior(behaviorId, fields) {
  const { valueIds, ...rest } = fields;
  const { data, error } = await supabase
    .from('behaviors').update(rest).eq('id', behaviorId).select().single();
  if (error) throw error;
  if (valueIds) await setBehaviorValues(behaviorId, valueIds);
  return data;
}

export async function deleteBehavior(behaviorId) {
  const { error } = await supabase.from('behaviors').delete().eq('id', behaviorId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ people */

export async function listMembers(orgId) {
  const { data, error } = await supabase
    .from('memberships')
    .select('id, role, display_name, user_id, email, team_id, avatar_path, inactive')
    .eq('org_id', orgId)
    .order('role');
  if (error) throw error;
  return data.map((m) => ({ ...m, avatar_url: avatarUrl(m.avatar_path) }));
}

/* -------------------------------------------------- administration of users */

/**
 * Calls an edge function and, when it fails, surfaces the function's own
 * explanation. On an error the library leaves `data` empty and puts the reply
 * in `error.context`; reading `data` alone only ever yields "Edge Function
 * returned a non-2xx status code", which says nothing useful.
 */
async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;

  let message = error.message;
  const reply = error.context;
  if (reply && typeof reply.clone === 'function') {
    try {
      const parsed = await reply.clone().json();
      message = parsed?.error || parsed?.message || message;
      if (parsed?.detail) message += ` (${parsed.detail})`;
    } catch {
      try {
        const text = await reply.text();
        if (text) message = text;
      } catch { /* keep the library's message */ }
    }
    if (reply.status === 404) {
      message = `The ${name} function is not deployed. Run: supabase functions deploy ${name}`;
    }
  }
  throw new Error(message);
}

/**
 * Creating an account needs the admin API, which never belongs in a browser,
 * so these go through the manage-users edge function. It re-checks the
 * caller's role with their own token before doing anything.
 */
async function manageUsers(action, payload) {
  return invokeFunction('manage-users', { action, ...payload });
}

export const createUser = (orgId, { email, name, role, password, sendWelcome = true }) =>
  manageUsers('create', { orgId, email, name, role, password, sendWelcome });

/** Sends, or re-sends, the welcome note to someone already in the organization. */
export const sendWelcomeEmail = (userId) => manageUsers('send-welcome', { userId });

export const updateUserRole = (userId, role) => manageUsers('set-role', { userId, role });
export const removeUser = (userId) => manageUsers('remove', { userId });
export const resetUserPassword = (userId, password) => manageUsers('reset-password', { userId, password });

export async function createOrganization(fields) {
  const { data, error } = await supabase.from('organizations').insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function listAllOrganizations() {
  const { data, error } = await supabase.from('organizations').select('*').order('name');
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------ content */

export async function listCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('position');
  if (error) throw error;
  return data;
}

export async function listValues(orgId) {
  const { data, error } = await supabase
    .from('values_')
    .select('*')
    .eq('org_id', orgId)
    .order('position');
  if (error) throw error;
  return data;
}

export async function listSystemCategories(orgId) {
  const { data, error } = await supabase
    .from('system_categories')
    .select('*')
    .eq('org_id', orgId)
    .order('position');
  if (error) throw error;
  return data;
}

export async function createSystemCategory(orgId, name, position = 99) {
  const { data, error } = await supabase
    .from('system_categories')
    .insert({ org_id: orgId, name, position })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSystemCategory(id) {
  const { error } = await supabase.from('system_categories').delete().eq('id', id);
  if (error) throw error;
}

/**
 * One round trip for everything the Clarity and behavior pages need:
 * behaviors with their values, placements and rituals.
 */
export async function listBehaviors(orgId) {
  // R4: the database moves the featured behavior on the organization's cadence.
  try { await supabase.rpc('maybe_advance_weekly', { p_org: orgId }); } catch { /* not migrated yet */ }
  const { data, error } = await supabase
    .from('behaviors')
    .select(`
      *,
      behavior_values ( values_ ( id, name, category ) ),
      placements ( id, owner, cadence, artifact, template,
                   system_categories ( id, name ) ),
      behavior_rituals ( rituals ( id, name, cadence, owner, description, practice ) )
    `)
    .eq('org_id', orgId)
    .eq('archived', false)
    .order('number');
  if (error) throw error;

  return data.map((b) => ({
    ...b,
    values: b.behavior_values.map((v) => v.values_).filter(Boolean),
    placements: b.placements.map((p) => ({
      id: p.id,
      owner: p.owner,
      cadence: p.cadence,
      artifact: p.artifact,
      template: p.template,
      systemId: p.system_categories?.id,
      system: p.system_categories?.name
    })),
    rituals: b.behavior_rituals.map((r) => r.rituals).filter(Boolean)
  }));
}

export async function setBehaviorValues(behaviorId, valueIds) {
  const { error: delErr } = await supabase
    .from('behavior_values')
    .delete()
    .eq('behavior_id', behaviorId);
  if (delErr) throw delErr;
  if (!valueIds.length) return;
  const { error } = await supabase
    .from('behavior_values')
    .insert(valueIds.map((value_id) => ({ behavior_id: behaviorId, value_id })));
  if (error) throw error;
}

/* --------------------------------------------------------------- placements */

export async function applySystem(orgId, behaviorId, { systemId, owner, cadence, artifact, template }) {
  const { data, error } = await supabase
    .from('placements')
    .insert({
      org_id: orgId,
      behavior_id: behaviorId,
      system_category_id: systemId,
      owner,
      cadence,
      artifact,
      template: template || null
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePlacement(placementId, fields) {
  const row = {};
  for (const k of ['owner', 'cadence', 'artifact', 'template']) if (fields[k] !== undefined) row[k] = fields[k];
  const { error } = await supabase.from('placements').update(row).eq('id', placementId);
  if (error) throw error;
}

export async function savePlacementTemplate(placementId, template) {
  const { error } = await supabase.from('placements').update({ template }).eq('id', placementId);
  if (error) throw error;
}

export async function removePlacement(placementId) {
  const { error } = await supabase.from('placements').delete().eq('id', placementId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ rituals */

export async function listRituals(orgId) {
  const { data, error } = await supabase
    .from('rituals')
    .select('*, behavior_rituals ( behaviors ( id, number, title ) )')
    .eq('org_id', orgId)
    .order('created_at');
  if (error) throw error;
  return data.map((r) => ({
    ...r,
    behaviors: r.behavior_rituals.map((b) => b.behaviors).filter(Boolean)
  }));
}

export async function createRitual(orgId, ritual) {
  const { data, error } = await supabase
    .from('rituals')
    .insert({ org_id: orgId, ...ritual })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Editing an example ritual makes it yours, so clearing examples leaves it.
export async function saveRitualPractice(ritualId, practice) {
  const { error } = await supabase.from('rituals').update({ practice, is_example: false }).eq('id', ritualId);
  if (error) throw error;
}

export async function updateRitual(ritualId, fields) {
  const { data, error } = await supabase
    .from('rituals').update({ ...fields, is_example: false }).eq('id', ritualId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRitual(ritualId) {
  const { error } = await supabase.from('rituals').delete().eq('id', ritualId);
  if (error) throw error;
}

/** Applying a ritual carries its practice with it; nothing is copied. */
export async function applyRitual(behaviorId, ritualId) {
  const { error } = await supabase
    .from('behavior_rituals')
    .insert({ behavior_id: behaviorId, ritual_id: ritualId });
  if (error) throw error;
}

export async function unapplyRitual(behaviorId, ritualId) {
  const { error } = await supabase
    .from('behavior_rituals')
    .delete()
    .eq('behavior_id', behaviorId)
    .eq('ritual_id', ritualId);
  if (error) throw error;
}

/* -------------------------------------------------------------- iterations */

export async function recordIteration(orgId, { ritualId = null, systemId = null, teamId = null, behaviorIds = [], heldAt, notes, files = [], isDraft = false }) {
  if (!!ritualId === !!systemId) throw new Error('An iteration is a run of one ritual or one system.');
  if (!behaviorIds.length) throw new Error('Pick at least one behavior this covered.');
  const { data: { user } } = await supabase.auth.getUser();
  const { data: it, error } = await supabase.from('iterations').insert({
    org_id: orgId, ritual_id: ritualId, system_category_id: systemId, team_id: teamId,
    behavior_ids: behaviorIds,
    recorded_by: user.id, recorded_by_name: user.user_metadata?.display_name ?? user.email,
    held_at: heldAt ?? new Date().toISOString(), notes: notes ?? null, is_draft: !!isDraft
  }).select().single();
  if (error) throw error;

  for (const file of files) {
    const path = `${orgId}/iterations/${it.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('story-media').upload(path, file, { contentType: file.type });
    if (upErr) throw upErr;
    await supabase.from('iteration_attachments').insert({
      iteration_id: it.id, storage_path: path, file_name: file.name,
      mime_type: file.type, byte_size: file.size,
      kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
    });
  }
  return it.id;
}

/**
 * behavior_ids is an array column, so Postgres cannot join it. The behaviors
 * are looked up in one extra query and attached, which the local backend has
 * always done; hosted mode was missing them.
 */
async function attachBehaviors(rows, orgId, full = false) {
  const ids = [...new Set(rows.flatMap((r) => r.behavior_ids ?? []))];
  if (!ids.length) return rows.map((r) => ({ ...r, behaviors: [] }));
  const { data, error } = await supabase
    .from('behaviors')
    .select(full ? 'id, number, title, description, category' : 'id, number, title')
    .in('id', ids);
  if (error) throw error;
  const byId = Object.fromEntries(data.map((b) => [b.id, b]));
  return rows.map((r) => ({
    ...r,
    behaviors: (r.behavior_ids ?? []).map((id) => byId[id]).filter(Boolean).sort((a, b) => a.number - b.number)
  }));
}

const ITERATION_SELECT =
  '*, rituals ( id, name, cadence, owner, description, practice, applies_to_all ), ' +
  'system_categories ( id, name ), iteration_attachments ( * )';

export async function listIterations(orgId, { behaviorId, ritualId, systemId, days } = {}) {
  let q = supabase
    .from('iterations')
    .select(ITERATION_SELECT)
    .eq('org_id', orgId)
    .order('held_at', { ascending: false });
  if (ritualId) q = q.eq('ritual_id', ritualId);
  if (systemId) q = q.eq('system_category_id', systemId);
  if (behaviorId) q = q.contains('behavior_ids', [behaviorId]);
  if (days) q = q.gte('held_at', new Date(Date.now() - days * 86400000).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  const rows = data.map((it) => ({
    ...it, ritual: it.rituals, system: it.system_categories, attachments: it.iteration_attachments ?? []
  }));
  return attachBehaviors(rows, orgId);
}

export async function getIteration(id) {
  const { data, error } = await supabase
    .from('iterations')
    .select('*, rituals ( * ), system_categories ( id, name ), iteration_attachments ( * )')
    .eq('id', id).single();
  if (error) throw error;
  const [row] = await attachBehaviors([{ ...data, ritual: data.rituals, system: data.system_categories,
    attachments: data.iteration_attachments ?? [] }], data.org_id, true);
  // A system run shows the template it followed.
  if (row.system && row.behavior_ids?.length) {
    const { data: p } = await supabase
      .from('placements')
      .select('template, artifact, owner, cadence')
      .eq('system_category_id', row.system_category_id)
      .in('behavior_id', row.behavior_ids)
      .limit(1);
    if (p?.[0]) row.system = { ...row.system, ...p[0] };
  }
  return row;
}

export async function deleteIteration(id) {
  await deleteRecord('iteration', id);
}

/* ------------------------------------------------- single records by id */

export async function getStory(id) {
  const { data, error } = await supabase
    .from('stories').select('*, behaviors ( * ), story_attachments ( * )').eq('id', id).single();
  if (error) throw error;
  return { ...data, behavior: data.behaviors };
}

export async function getRecognition(id) {
  const { data, error } = await supabase
    .from('recognitions').select('*, behaviors ( * ), recognition_attachments ( * )').eq('id', id).single();
  if (error) throw error;
  return { ...data, behavior: data.behaviors, attachments: data.recognition_attachments ?? [] };
}

export async function getRitual(id) {
  const { data, error } = await supabase
    .from('rituals').select('*, behavior_rituals ( behaviors ( id, number, title ) )').eq('id', id).single();
  if (error) throw error;
  return { ...data, behaviors: data.behavior_rituals.map((b) => b.behaviors).filter(Boolean) };
}

/* ---------------------------------------------------------------- measures */

export async function listMeasures(orgId) {
  const { data, error } = await supabase
    .from('measures').select('*').eq('org_id', orgId).order('position');
  if (error) throw error;
  return data;
}

export async function createMeasure(orgId, fields) {
  const { data, error } = await supabase
    .from('measures').insert({ org_id: orgId, ...fields }).select().single();
  if (error) throw error;
  return data;
}

export async function updateMeasure(id, fields) {
  const { error } = await supabase.from('measures').update(fields).eq('id', id);
  if (error) throw error;
}

export async function deleteMeasure(id) {
  const { error } = await supabase.from('measures').delete().eq('id', id);
  if (error) throw error;
}

export async function listMeasureEntries(orgId) {
  const { data, error } = await supabase
    .from('measure_entries').select('*').eq('org_id', orgId).order('recorded_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function recordMeasureEntry(orgId, { period, values }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('measure_entries').insert({
    org_id: orgId, period, values,
    recorded_by_name: user.user_metadata?.display_name ?? user.email
  });
  if (error) throw error;
}

/* ------------------------------------------------------------------- pulse */

/** A few behaviors to rate now, or with { all: true } every one left this round. */
export async function getPulseAssignment(orgId, { all = false } = {}) {
  const { data, error } = await supabase.rpc('pulse_assignment', { p_org: orgId, p_all: all });
  if (error) throw error;
  return data;
}

export async function getPulseStatus(orgId) {
  const { data, error } = await supabase.rpc('pulse_status', { p_org: orgId });
  if (error) throw error;
  return data;
}

/**
 * The database picks the round and checks each behavior, so the browser only
 * says which behaviors and what score. Returns where the pulse stands after.
 */
export async function submitPulse(orgId, answers) {
  const scores = Object.fromEntries(Object.entries(answers).map(([id, s]) => [id, Number(s)]));
  const { data, error } = await supabase.rpc('submit_pulse', { p_org: orgId, p_answers: scores });
  if (error) throw error;
  return data;
}

/** Admins: the share of active members who must rate everything to close a round. */
export async function setPulseClosePct(orgId, pct) {
  const { data, error } = await supabase.rpc('set_pulse_close_pct', { p_org: orgId, p_pct: pct });
  if (error) throw error;
  return data;
}

/** Admins: close the open round now, with the answers it has. */
export async function closePulseRound(orgId) {
  const { data, error } = await supabase.rpc('close_pulse_round', { p_org: orgId });
  if (error) throw error;
  return data;
}

/** Every round, newest first: the open one, then each closed one with its date. */
export async function listPulseRounds(orgId) {
  const { data, error } = await supabase.rpc('pulse_round_history', { p_org: orgId });
  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------- bulk apply and reordering */

export async function applySystemToBehaviors(orgId, behaviorIds, p) {
  const rows = behaviorIds.map((behavior_id) => ({
    org_id: orgId, behavior_id, system_category_id: p.systemId,
    owner: p.owner, cadence: p.cadence, artifact: p.artifact, template: p.template || null
  }));
  const { error } = await supabase.from('placements').upsert(rows, { onConflict: 'behavior_id,system_category_id' });
  if (error) throw error;
}

export async function setRitualBehaviors(ritualId, behaviorIds) {
  await supabase.from('behavior_rituals').delete().eq('ritual_id', ritualId);
  if (!behaviorIds.length) return;
  const { error } = await supabase.from('behavior_rituals')
    .insert(behaviorIds.map((behavior_id) => ({ behavior_id, ritual_id: ritualId })));
  if (error) throw error;
}

export async function reorderBehaviors(orgId, orderedIds) {
  // Two passes: park the numbers out of the way, then set them, so the
  // unique (org_id, number) constraint never collides mid-update.
  for (const [i, id] of orderedIds.entries()) {
    await supabase.from('behaviors').update({ number: 1000 + i }).eq('id', id);
  }
  for (const [i, id] of orderedIds.entries()) {
    const { error } = await supabase.from('behaviors').update({ number: i + 1 }).eq('id', id);
    if (error) throw error;
  }
}

export async function updateSystemCategory(id, fields) {
  const { error } = await supabase.from('system_categories').update(fields).eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------- joining: three ways in */

/**
 * Creating an organization and its first account needs the service role, so
 * it runs in the signup function, which also seeds the example content.
 */
export async function createPortal(fields) {
  const data = await invokeFunction('signup', { action: 'create-portal', ...fields });
  // The function returns a session the browser can adopt.
  if (data?.session) await supabase.auth.setSession(data.session);
  return data;
}

export async function listOrganizationNames() {
  const { data, error } = await supabase.rpc('organization_names');
  if (error) throw error;
  return data ?? [];
}

export async function requestAccess(fields) {
  const data = await invokeFunction('signup', { action: 'request-access', ...fields });
  return data;
}

export async function listAccessRequests(orgId) {
  const { data, error } = await supabase
    .from('access_requests').select('*').eq('org_id', orgId).eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ ...r, at: r.created_at }));
}

export async function approveRequest(requestId, role = 'member') {
  const data = await invokeFunction('manage-users', { action: 'approve-request', requestId, role });
  return data;
}

export async function declineRequest(requestId) {
  const { error } = await supabase
    .from('access_requests').update({ status: 'declined' }).eq('id', requestId);
  if (error) throw error;
}

/** Supabase sends its own reset mail; the app just asks for it. */
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), {
    // The slash matters: Supabase only returns people to addresses on its
    // allow list, and https://site/** does not match https://site?reset=1.
    redirectTo: `${window.location.origin}/?reset=1`
  });
  if (error) throw error;
  return { sent: true, hosted: true };
}

/** Supabase announces a recovery sign-in; this passes that on to the app. */
export function onPasswordRecovery(callback) {
  if (!supabase) return { unsubscribe() {} };
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') callback();
  });
  return data.subscription;
}

export async function resetPassword({ password }) {
  // The link in the email signs the browser in, so this is a normal update.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return true;
}

export async function clearExampleContent(orgId) {
  // The example history first, then what it hangs from.
  for (const table of ['iterations', 'recognitions', 'stories', 'award_grants', 'award_types', 'teams', 'rituals']) {
    await supabase.from(table).delete().eq('org_id', orgId).eq('is_example', true);
  }
  await supabase.from('behaviors').delete().eq('org_id', orgId).eq('is_example', true);
  await supabase.from('values_').delete().eq('org_id', orgId).eq('is_example', true);
  await supabase.from('system_categories').delete().eq('org_id', orgId).eq('is_example', true);
  const { error } = await supabase
    .from('organizations').update({ has_example_content: false }).eq('id', orgId);
  if (error) throw error;
}

export async function listOutbox() {
  // Hosted mode sends real mail, so there is nothing to show here.
  return [];
}

export async function listMemberEmails(orgId) {
  const { data, error } = await supabase.from('memberships').select('email, email_opt_out').eq('org_id', orgId);
  if (error) throw error;
  // People who opted out of portal email are left off shares and prompts.
  return data.filter((m) => !m.email_opt_out).map((m) => m.email).filter(Boolean);
}

/** Anyone can stop portal email; account and billing email still arrive. */
export async function setEmailOptOut(optOut) {
  const { error } = await supabase.rpc('set_my_email_opt_out', { p_opt_out: !!optOut });
  if (error) throw error;
}

export async function getMyEmailOptOut() {
  const { data } = await supabase.auth.getUser();
  const { data: row } = await supabase.from('memberships').select('email_opt_out')
    .eq('user_id', data?.user?.id ?? '').maybeSingle();
  return !!row?.email_opt_out;
}

/** Hosted rotation: the database advances the featured behavior on the org's cadence. */
export async function setBotwCadence(orgId, { cadence, day }) {
  const { error } = await supabase.from('organizations')
    .update({ botw_cadence: cadence, botw_day: Math.min(28, Math.max(1, Number(day) || 1)), weekly_set_at: new Date().toISOString() })
    .eq('id', orgId);
  if (error) throw error;
}

export async function deleteStory(id) {
  await deleteRecord('story', id);
}

export async function deleteRecognition(id) {
  await deleteRecord('recognition', id);
}

/* ----------------------------------------------------------------- billing */

export async function getBilling(orgId) {
  const { data, error } = await supabase.rpc('billing_status', { p_org: orgId });
  if (error) throw error;
  if (!data) return null;
  // The database answers who has access (access_state); the same rules in
  // billing.js give the screens their wording and dates.
  const today = new Date().toISOString().slice(0, 10);
  const org = data.org ?? {};
  return {
    ...data, today, org,
    state: accessState(org, today),
    trial_ends_at: org.trial_ends_at, trial_used: !!org.trial_used,
    has_payment_method: !!org.has_payment_method, card_last4: org.card_last4 ?? null,
    override: org.override_kind ? {
      kind: org.override_kind, plan: org.override_plan, until: org.override_until, note: org.override_note
    } : null,
    clock_offset: 0
  };
}

/** Super user: what this organization is charged. The trigger refuses anyone else. */
export async function setBillingRates(orgId, rates) {
  const { error } = await supabase.from('organizations').update(rates).eq('id', orgId);
  if (error) throw error;
}

/** Super user: set any billing field by hand. */
export async function setBillingStatus(orgId, fields) {
  const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === '' ? null : v]));
  if (clean.paid_through !== undefined) clean.pending_change = null;
  const { error } = await supabase.from('organizations').update(clean).eq('id', orgId);
  if (error) throw error;
  await supabase.from('billing_events').insert({ org_id: orgId, kind: 'set-by-super', detail: clean });
}

/** Super user: an arrangement that wins over Stripe until its date. */
export async function setOverride(orgId, { kind, plan, until, note }) {
  const row = kind
    ? { override_kind: kind, override_plan: plan || 'unlimited', override_until: until, override_note: note ?? '' }
    : { override_kind: null, override_plan: null, override_until: null, override_note: null };
  const { error } = await supabase.from('organizations').update(row).eq('id', orgId);
  if (error) throw error;
  await supabase.from('billing_events').insert({
    org_id: orgId, kind: kind ? 'override-set' : 'override-cleared', detail: row
  });
}

/** The champion picks a plan and term; the first time, it starts the 30-day trial. */
export async function choosePlan(orgId, { plan, cycle }) {
  return invokeFunction('billing', { action: 'choose-plan', orgId, plan, cycle });
}

/**
 * Hands off to Stripe Checkout to collect a card and billing address. Stripe
 * works out the tax and holds the first charge until the trial ends.
 */
export async function addPaymentMethod(orgId) {
  const data = await invokeFunction('billing', {
    action: 'checkout', orgId, returnUrl: window.location.origin + window.location.pathname
  });
  if (data?.url) window.location.href = data.url;
  return data;
}

/** Stripe's own page for changing the card, reading invoices and receipts. */
export async function manageBilling(orgId) {
  const data = await invokeFunction('billing', {
    action: 'portal', orgId, returnUrl: window.location.origin + window.location.pathname
  });
  if (data?.url) window.location.href = data.url;
  return data;
}


/** A 30-day trial of the unlimited plan, for an organization that never had one. */
export async function startTrial(orgId) {
  return invokeFunction('billing', { action: 'start-trial', orgId });
}

/** Prices on the sign-in page and for new organizations. Readable signed out. */
export async function getPlatformPricing() {
  const { data, error } = await supabase.rpc('get_platform_pricing');
  if (error) throw error;
  return data;
}

export async function setPlatformPricing(rates) {
  const { error } = await supabase.from('platform_settings').update({ rates }).eq('id', 1);
  if (error) throw error;
}

/** Bring an inactive person back; the database refuses when the plan is full. */
export async function setMemberActive(userId, active) {
  const { error } = await supabase.from('memberships').update({ inactive: !active }).eq('user_id', userId);
  if (error) throw error;
}

/** Uploads the organization's logo to the public logos bucket. */
export async function setOrgLogo(orgId, file) {
  if (!file) {
    const { error } = await supabase.from('organizations').update({ logo_url: null }).eq('id', orgId);
    if (error) throw error;
    return null;
  }
  if (!/^image\/(png|jpeg|svg\+xml|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPG, SVG or WebP image.');
  if (file.size > 1024 * 1024) throw new Error('Keep the logo under 1 MB.');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${orgId}/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('logos').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  const { error } = await supabase.from('organizations').update({ logo_url: data.publicUrl }).eq('id', orgId);
  if (error) throw error;
  return data.publicUrl;
}

export async function listBillingEvents(orgId) {
  const { data, error } = await supabase
    .from('billing_events').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: false }).limit(12);
  if (error) throw error;
  return data.map((e) => ({ ...e, at: e.created_at, detail: e.detail }));
}

export async function resumeSubscription(orgId) {
  const data = await invokeFunction('billing', { action: 'resume', orgId });
  return data;
}

export async function cancelSubscription(orgId) {
  const data = await invokeFunction('billing', { action: 'cancel', orgId });
  return data;
}

export async function setAutoAdvance(orgId, on) {
  const { error } = await supabase
    .from('organizations').update({ auto_advance: on }).eq('id', orgId);
  if (error) throw error;
}

export async function setPulseCount(orgId, count) {
  const { error } = await supabase
    .from('organizations').update({ pulse_per_signin: count }).eq('id', orgId);
  if (error) throw error;
}

export async function setRecentWindow(orgId, days) {
  const { error } = await supabase.from('organizations').update({ recent_days: days }).eq('id', orgId);
  if (error) throw error;
}

/* ------------------------------------------------------ stories and sharing */

export async function listStories(orgId, { behaviorId } = {}) {
  let q = supabase
    .from('stories')
    .select('*, behaviors ( id, number, title ), story_attachments ( * )')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (behaviorId) q = q.eq('behavior_id', behaviorId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

function attachmentKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Any member can add a story. Files go to the story-media bucket under
 * {org_id}/{story_id}/, which is what the storage policies key on.
 */
export async function createStory(orgId, { behaviorId, body, authorName, files = [], isDraft = false }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: story, error } = await supabase
    .from('stories')
    .insert({
      org_id: orgId,
      behavior_id: behaviorId,
      author_id: user.id,
      author_name: authorName,
      body,
      is_draft: !!isDraft
    })
    .select()
    .single();
  if (error) throw error;

  for (const file of files) {
    const path = `${orgId}/${story.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('story-media')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;

    const { error: rowErr } = await supabase.from('story_attachments').insert({
      story_id: story.id,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
      kind: attachmentKind(file)
    });
    if (rowErr) throw rowErr;
  }
  return story;
}

/** Signed URLs so attachments render in the app without a public bucket. */
export async function signAttachment(path, seconds = 3600) {
  const { data, error } = await supabase.storage
    .from('story-media')
    .createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Sends the story by email. The edge function re-checks membership, signs the
 * attachments for seven days and records the send in story_shares.
 */
export async function shareStoryByEmail(storyId, recipients, note) {
  const data = await invokeFunction('share-story', { storyId, recipients, note });
  return data;
}

/* ------------------------------------------------------------- recognition */

export async function listRecognitions(orgId, { behaviorId } = {}) {
  let q = supabase
    .from('recognitions')
    .select('*, behaviors ( id, number, title ), recognition_attachments ( * )')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (behaviorId) q = q.eq('behavior_id', behaviorId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map((r) => ({ ...r, attachments: r.recognition_attachments ?? [] }));
}

export async function createRecognition(orgId, { behaviorId, recipient, recipientUserId = null, title = null, body, authorName, files = [], isDraft = false }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (recipientUserId && recipientUserId === user.id) throw new Error('Recognition goes to someone else.');
  const { data: rec, error } = await supabase.from('recognitions').insert({
    org_id: orgId,
    behavior_id: behaviorId,
    author_id: user.id,
    author_name: authorName,
    recipient,
    recipient_user_id: recipientUserId,
    title: title || null,
    body,
    is_draft: !!isDraft
  }).select().single();
  if (error) throw error;

  // Attachments were accepted by the form but never uploaded in hosted mode.
  for (const file of files) {
    const path = `${orgId}/recognitions/${rec.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('story-media').upload(path, file, { contentType: file.type });
    if (upErr) throw upErr;
    const { error: rowErr } = await supabase.from('recognition_attachments').insert({
      recognition_id: rec.id, storage_path: path, file_name: file.name,
      mime_type: file.type, byte_size: file.size, kind: attachmentKind(file)
    });
    if (rowErr) throw rowErr;
  }
}

/* ------------------------------------------------------------- measurement */

/** Average and spread per behavior for one round; the open round when none is given. */
export async function getPulse(orgId, round = null) {
  const { data, error } = await supabase.rpc('pulse_results', { p_org: orgId, p_round: round });
  if (error) throw error;
  return data ?? [];
}

export async function getCoverage(orgId) {
  const { data, error } = await supabase
    .from('behavior_coverage')
    .select('*')
    .eq('org_id', orgId)
    .order('number');
  if (error) throw error;
  return data;
}


/* ================================================================== R1 */

/** Avatars are in a public bucket, so a picture is one plain URL. */
function avatarUrl(path) {
  if (!path) return null;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

/* ----------------------------------------------------------------- people */

/** Members plus the super user, with team and picture: everyone a page can name. */
export async function listPeople(orgId) {
  const { data, error } = await supabase.rpc('org_people', { p_org: orgId });
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, avatar_url: avatarUrl(p.avatar_path) }));
}

/**
 * The file arrives already cropped and shrunk by the profile dialog. A new
 * name each time, so browsers and the CDN never show the old face.
 */
export async function uploadMyAvatar(orgId, file) {
  const { data: { user } } = await supabase.auth.getUser();
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `${orgId}/${user.id}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('avatars').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (upErr) throw upErr;

  const { data: old } = await supabase.storage.from('avatars').list(`${orgId}/${user.id}`);
  const { error } = await supabase.rpc('set_my_avatar', { p_path: path });
  if (error) throw error;
  // Tidy up earlier pictures. Failing here leaves a stray file, nothing more.
  const stale = (old ?? []).map((f) => `${orgId}/${user.id}/${f.name}`).filter((p) => p !== path);
  if (stale.length) await supabase.storage.from('avatars').remove(stale);
  return avatarUrl(path);
}

export async function removeMyAvatar(orgId) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.rpc('set_my_avatar', { p_path: null });
  if (error) throw error;
  const { data: old } = await supabase.storage.from('avatars').list(`${orgId}/${user.id}`);
  if (old?.length) await supabase.storage.from('avatars').remove(old.map((f) => `${orgId}/${user.id}/${f.name}`));
}

/* ------------------------------------------------------------------ teams */

export async function listTeams(orgId) {
  const { data, error } = await supabase
    .from('teams').select('*').eq('org_id', orgId).eq('archived', false).order('name');
  if (error) throw error;
  return data;
}

export async function createTeam(orgId, name) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('Name the team.');
  const { data, error } = await supabase
    .from('teams').insert({ org_id: orgId, name: clean }).select().single();
  if (error) {
    if (error.code === '23505') throw new Error(`There is already a team called ${clean}.`);
    throw error;
  }
  return data;
}

export async function renameTeam(teamId, name) {
  const { data, error } = await supabase
    .from('teams').update({ name: String(name).trim(), is_example: false }).eq('id', teamId).select().single();
  if (error) throw error;
  return data;
}

export async function setMemberTeam(orgId, userId, teamId) {
  const { error } = await supabase
    .from('memberships').update({ team_id: teamId || null }).eq('org_id', orgId).eq('user_id', userId);
  if (error) throw error;
}

/* ----------------------------------------------------------- value awards */

export async function listAwardTypes(orgId) {
  const { data, error } = await supabase
    .from('award_types')
    .select('*, award_type_values ( value_id )')
    .eq('org_id', orgId)
    .order('created_at');
  if (error) throw error;
  return data.map((a) => ({ ...a, valueIds: (a.award_type_values ?? []).map((v) => v.value_id) }));
}

export async function saveAwardType(orgId, fields) {
  const row = {
    org_id: orgId,
    name: String(fields.name ?? '').trim(),
    description: fields.description?.trim() || null,
    grantable_to: fields.grantable_to ?? 'both',
    grant_cap: fields.grant_cap ? Number(fields.grant_cap) : null,
    cap_period: fields.grant_cap ? fields.cap_period ?? 'quarter' : null,
    active: fields.active ?? true,
    // Editing an example award makes it yours, so clearing examples leaves it.
    is_example: false
  };
  if (!row.name) throw new Error('Name the award.');
  if (!fields.valueIds?.length) throw new Error('Pick at least one Value this award stands for.');

  const q = fields.id
    ? supabase.from('award_types').update(row).eq('id', fields.id)
    : supabase.from('award_types').insert(row);
  const { data, error } = await q.select().single();
  if (error) throw error;

  await supabase.from('award_type_values').delete().eq('award_type_id', data.id);
  const { error: vErr } = await supabase.from('award_type_values')
    .insert(fields.valueIds.map((value_id) => ({ award_type_id: data.id, value_id })));
  if (vErr) throw vErr;
  return data;
}

export async function listAwardGrants(orgId) {
  const { data, error } = await supabase
    .from('award_grants')
    .select('*, award_types ( *, award_type_values ( value_id ) ), award_grant_recipients ( user_id ), award_grant_attachments ( * )')
    .eq('org_id', orgId)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return data.map((g) => ({
    ...g,
    award: g.award_types
      ? { ...g.award_types, valueIds: (g.award_types.award_type_values ?? []).map((v) => v.value_id) }
      : null,
    recipients: (g.award_grant_recipients ?? []).map((r) => r.user_id),
    attachments: g.award_grant_attachments ?? []
  }));
}

export async function grantAward(orgId, { awardTypeId, recipientUserId = null, teamId = null, citation, recipientName, files = [], isDraft = false }) {
  if (!!recipientUserId === !!teamId) throw new Error('An award goes to one person or one team.');
  if (!String(citation ?? '').trim()) throw new Error('Write the citation: what they did.');
  const { data: { user } } = await supabase.auth.getUser();
  if (recipientUserId === user.id) throw new Error('A Value award goes to someone else.');
  const { data, error } = await supabase.from('award_grants').insert({
    org_id: orgId, award_type_id: awardTypeId,
    recipient_user_id: recipientUserId, team_id: teamId, recipient_name: recipientName,
    granted_by: user.id, granted_by_name: user.user_metadata?.display_name ?? user.email,
    citation: citation.trim(), is_draft: !!isDraft
  }).select().single();
  // The cap and recipient rules live in a trigger; its message is the useful part.
  if (error) throw new Error(error.message?.replace(/^.*?ERROR:\s*/, '') || 'That award could not be given.');

  for (const file of files) {
    const path = `${orgId}/awards/${data.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('story-media').upload(path, file, { contentType: file.type });
    if (upErr) throw upErr;
    const { error: rowErr } = await supabase.from('award_grant_attachments').insert({
      grant_id: data.id, storage_path: path, file_name: file.name,
      mime_type: file.type, byte_size: file.size, kind: attachmentKind(file)
    });
    if (rowErr) throw rowErr;
  }
  return data;
}

/* ------------------------------------------------ sharing by email, R2 */

/** Same email function as stories; it formats each kind of record its own way. */
export const shareRecognitionByEmail = (id, recipients, note) =>
  invokeFunction('share-story', { kind: 'recognition', id, recipients, note });
export const shareAwardByEmail = (id, recipients, note) =>
  invokeFunction('share-story', { kind: 'award', id, recipients, note });

/* ---------------------------------------------------------------- fluency */

export async function listMyFluencyMarks(orgId) {
  const { data, error } = await supabase
    .from('fluency_marks').select('behavior_id, step, marked_at').eq('org_id', orgId);
  if (error) throw error;
  // Having rated a behavior in any pulse round is a fluency step too.
  const { data: auth } = await supabase.auth.getUser();
  const { data: rated } = await supabase.from('pulse_responses').select('behavior_id')
    .eq('org_id', orgId).eq('user_id', auth?.user?.id ?? '');
  const ids = [...new Set((rated ?? []).map((r) => r.behavior_id))];
  return [...data, ...ids.map((behavior_id) => ({ behavior_id, step: 'rated' }))];
}

/** Reading steps are recorded once; a repeat is a quiet no-op. */
export async function markFluency(orgId, behaviorId, step) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('fluency_marks')
    .upsert({ user_id: user.id, behavior_id: behaviorId, org_id: orgId, step },
      { onConflict: 'user_id,behavior_id,step', ignoreDuplicates: true });
  if (error) throw error;
}

/* ---------------------------------------------------------- pulse history */

export async function getPulseSpreadByRound(orgId) {
  const { data, error } = await supabase.rpc('pulse_spread_by_round', { p_org: orgId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, spread: Number(r.spread) }));
}


/* ================================================================== R3 */
/* Editing, drafts and deleting. Row level security decides who may; these
   calls report plainly when the answer is no.                             */

const RECORDS = {
  story:       { table: 'stories',      files: 'story_attachments',       fk: 'story_id',       folder: (o, id) => `${o}/${id}` },
  recognition: { table: 'recognitions', files: 'recognition_attachments', fk: 'recognition_id', folder: (o, id) => `${o}/recognitions/${id}` },
  iteration:   { table: 'iterations',   files: 'iteration_attachments',   fk: 'iteration_id',   folder: (o, id) => `${o}/iterations/${id}` },
  award:       { table: 'award_grants', files: 'award_grant_attachments', fk: 'grant_id',       folder: (o, id) => `${o}/awards/${id}` }
};

const NOT_ALLOWED = 'Only the person who made it, the culture champion or an admin can change that.';
const clean = (e) => new Error(e?.message?.replace(/^.*?ERROR:\s*/, '') || 'That could not be saved.');

async function uploadRecordFiles(kind, orgId, id, files = []) {
  const r = RECORDS[kind];
  for (const file of files) {
    const path = `${r.folder(orgId, id)}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from('story-media').upload(path, file, { contentType: file.type });
    if (upErr) throw upErr;
    const { error } = await supabase.from(r.files).insert({
      [r.fk]: id, storage_path: path, file_name: file.name,
      mime_type: file.type, byte_size: file.size, kind: attachmentKind(file)
    });
    if (error) throw clean(error);
  }
}

async function removeRecordFiles(kind, fileIds = []) {
  if (!fileIds.length) return;
  const r = RECORDS[kind];
  const { data, error } = await supabase.from(r.files).delete().in('id', fileIds).select('storage_path');
  if (error) throw clean(error);
  const paths = (data ?? []).map((x) => x.storage_path);
  // The row is what the portal shows; a file left behind in storage is harmless.
  if (paths.length) await supabase.storage.from('story-media').remove(paths).catch(() => {});
}

async function updateRecord(kind, id, fields, { addFiles = [], removeFileIds = [] } = {}) {
  const r = RECORDS[kind];
  const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  let row;
  if (Object.keys(patch).length) {
    // Editing an example makes it yours, so clearing examples leaves it.
    patch.is_example = false;
    const { data, error } = await supabase.from(r.table).update(patch).eq('id', id).select();
    if (error) throw clean(error);
    if (!data?.length) throw new Error(NOT_ALLOWED);
    row = data[0];
  } else {
    const { data, error } = await supabase.from(r.table).select('*').eq('id', id).single();
    if (error) throw clean(error);
    row = data;
  }
  await removeRecordFiles(kind, removeFileIds);
  await uploadRecordFiles(kind, row.org_id, id, addFiles);
  return row;
}

async function deleteRecord(kind, id) {
  const r = RECORDS[kind];
  const { data: files } = await supabase.from(r.files).select('storage_path').eq(r.fk, id);
  const { data, error } = await supabase.from(r.table).delete().eq('id', id).select('id');
  if (error) throw clean(error);
  if (!data?.length) throw new Error('Only the person who made it, the culture champion or an admin can delete that.');
  const paths = (files ?? []).map((f) => f.storage_path);
  if (paths.length) await supabase.storage.from('story-media').remove(paths).catch(() => {});
}

const draftField = (isDraft) => (isDraft === undefined ? undefined : !!isDraft);

export const updateStory = (id, { behaviorId, body, isDraft, addFiles, removeFileIds }) =>
  updateRecord('story', id, { behavior_id: behaviorId, body, is_draft: draftField(isDraft) }, { addFiles, removeFileIds });

export async function updateRecognition(id, { behaviorId, recipientUserId, recipient, title, body, isDraft, addFiles, removeFileIds }) {
  return updateRecord('recognition', id, {
    behavior_id: behaviorId, recipient_user_id: recipientUserId, recipient,
    title: title === undefined ? undefined : (title || null), body, is_draft: draftField(isDraft)
  }, { addFiles, removeFileIds });
}

export const updateIteration = (id, { behaviorIds, teamId, heldAt, notes, isDraft, addFiles, removeFileIds }) =>
  updateRecord('iteration', id, {
    behavior_ids: behaviorIds, team_id: teamId === undefined ? undefined : (teamId || null),
    held_at: heldAt, notes, is_draft: draftField(isDraft)
  }, { addFiles, removeFileIds });

export const updateAwardGrant = (id, { citation, isDraft, addFiles, removeFileIds }) =>
  updateRecord('award', id, {
    citation: citation === undefined ? undefined : citation.trim(), is_draft: draftField(isDraft)
  }, { addFiles, removeFileIds });

export const deleteAwardGrant = (id) => deleteRecord('award', id);
