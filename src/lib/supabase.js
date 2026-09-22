import { createClient } from '@supabase/supabase-js';

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

export async function changeOwnPassword(_current, next) {
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw error;
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
    return data.map((o) => ({ ...o, role: 'owner', displayName: 'Super user', isSuper: true }));
  }

  const { data, error } = await supabase
    .from('memberships')
    .select('role, display_name, organizations(*)')
    .limit(1);
  if (error) throw error;
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

export async function createValue(orgId, { name, description, position = 99 }) {
  const { data, error } = await supabase
    .from('values_').insert({ org_id: orgId, name, description, position }).select().single();
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
    .select('id, role, display_name, user_id, email')
    .eq('org_id', orgId)
    .order('role');
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from('behaviors')
    .select(`
      *,
      behavior_values ( values_ ( id, name ) ),
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

export async function upsertBehavior(orgId, behavior) {
  const { data, error } = await supabase
    .from('behaviors')
    .upsert({ org_id: orgId, ...behavior })
    .select()
    .single();
  if (error) throw error;
  return data;
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

export async function saveRitualPractice(ritualId, practice) {
  const { error } = await supabase.from('rituals').update({ practice }).eq('id', ritualId);
  if (error) throw error;
}

export async function updateRitual(ritualId, fields) {
  const { data, error } = await supabase
    .from('rituals').update(fields).eq('id', ritualId).select().single();
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

export async function recordIteration(orgId, { ritualId, behaviorIds = [], heldAt, notes, files = [] }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: it, error } = await supabase.from('iterations').insert({
    org_id: orgId, ritual_id: ritualId, behavior_ids: behaviorIds,
    recorded_by: user.id, recorded_by_name: user.user_metadata?.display_name ?? user.email,
    held_at: heldAt ?? new Date().toISOString(), notes: notes ?? null
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

export async function listIterations(orgId, { behaviorId, ritualId, days } = {}) {
  let q = supabase
    .from('iterations')
    .select('*, rituals ( id, name, cadence, owner, description, practice ), iteration_attachments ( * )')
    .eq('org_id', orgId)
    .order('held_at', { ascending: false });
  if (ritualId) q = q.eq('ritual_id', ritualId);
  if (behaviorId) q = q.contains('behavior_ids', [behaviorId]);
  if (days) q = q.gte('held_at', new Date(Date.now() - days * 86400000).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  return data.map((it) => ({ ...it, ritual: it.rituals, attachments: it.iteration_attachments ?? [] }));
}

export async function getIteration(id) {
  const { data, error } = await supabase
    .from('iterations')
    .select('*, rituals ( * ), iteration_attachments ( * )')
    .eq('id', id).single();
  if (error) throw error;
  return { ...data, ritual: data.rituals, attachments: data.iteration_attachments ?? [] };
}

export async function deleteIteration(id) {
  const { error } = await supabase.from('iterations').delete().eq('id', id);
  if (error) throw error;
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

export async function getPulseAssignment(orgId) {
  const { data, error } = await supabase.rpc('pulse_assignment', { p_org: orgId });
  if (error) throw error;
  return data;
}

export async function getPulseStatus(orgId) {
  const { data, error } = await supabase.rpc('pulse_status', { p_org: orgId });
  if (error) throw error;
  return data;
}

export async function submitPulse(orgId, answers) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: status } = await supabase.rpc('pulse_status', { p_org: orgId });
  const rows = Object.entries(answers).map(([behavior_id, score]) => ({
    org_id: orgId, behavior_id, user_id: user.id, score: Number(score), round: status?.round ?? 1
  }));
  const { error } = await supabase
    .from('pulse_responses').upsert(rows, { onConflict: 'round,behavior_id,user_id' });
  if (error) throw error;
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
  const { data, error } = await supabase.from('memberships').select('email').eq('org_id', orgId);
  if (error) throw error;
  return data.map((m) => m.email).filter(Boolean);
}

export async function deleteStory(id) {
  const { error } = await supabase.from('stories').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteRecognition(id) {
  const { error } = await supabase.from('recognitions').delete().eq('id', id);
  if (error) throw error;
}

/* ----------------------------------------------------------------- billing */

export async function getBilling(orgId) {
  const { data, error } = await supabase.rpc('billing_status', { p_org: orgId });
  if (error) throw error;
  return data;
}

export async function setBillingRates(orgId, rates) {
  const { error } = await supabase.from('organizations').update(rates).eq('id', orgId);
  if (error) throw error;
}

export async function setBillingStatus(orgId, fields) {
  const { error } = await supabase.from('organizations').update(fields).eq('id', orgId);
  if (error) throw error;
}

/** Hands off to Stripe Checkout; the webhook writes the result back. */
export async function startCheckout(orgId, { plan, cycle }) {
  const data = await invokeFunction('billing', { action: 'checkout', orgId, plan, cycle, returnUrl: window.location.href });
  if (data?.url) window.location.href = data.url;
  return data;
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
export async function createStory(orgId, { behaviorId, body, authorName, files = [] }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: story, error } = await supabase
    .from('stories')
    .insert({
      org_id: orgId,
      behavior_id: behaviorId,
      author_id: user.id,
      author_name: authorName,
      body
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
    .select('*, behaviors ( id, number, title )')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (behaviorId) q = q.eq('behavior_id', behaviorId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createRecognition(orgId, { behaviorId, recipient, body, authorName }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('recognitions').insert({
    org_id: orgId,
    behavior_id: behaviorId,
    author_id: user.id,
    author_name: authorName,
    recipient,
    body
  });
  if (error) throw error;
}

/* ------------------------------------------------------------- measurement */

export async function getPulse(orgId) {
  const { data, error } = await supabase
    .from('behavior_pulse')
    .select('*')
    .eq('org_id', orgId)
    .order('avg_score');
  if (error) throw error;
  return data;
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

