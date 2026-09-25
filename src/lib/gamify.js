/**
 * Streaks, badges and trophies, worked out from records the portal already
 * keeps: iterations, recognition, stories, fluency marks, value award grants
 * and the pulse. Nothing here is stored, so a badge can never fall out of
 * step with the activity behind it, and both backends get identical results.
 *
 * Every function is pure: data in, numbers out.
 *
 * Definitions, in one place:
 * - A week runs Monday to Sunday in the viewer's time zone.
 * - Behavior of the Week is "discussed" in a week when the practice session
 *   (the ritual that applies to every behavior) has an iteration that week.
 * - A behavior is "practiced" in a week when any other ritual, or any system,
 *   has an iteration covering it that week. The session is counted as
 *   discussion, not practice, so the two signals stay separate.
 * - Team credit follows the team tagged on the iteration.
 * - The week in progress never breaks a streak. It adds to it once logged.
 */

const DAY = 86400000;

/* ------------------------------------------------------------------ weeks */

export function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export const weekKey = (d) => {
  const w = weekStart(d);
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`;
};

/** The last n week starts, oldest first, ending with this week. */
export function lastWeeks(n, today = new Date()) {
  const start = weekStart(today);
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() - (n - 1 - i) * 7 * DAY));
}

/** The organization's recent window is set in days; badges count weeks. */
export function recentWeeks(org) {
  return Math.max(1, Math.round((org?.recent_days ?? 45) / 7));
}

/* ----------------------------------------------------------------- scopes */

/**
 * scope is { kind: 'org' } or { kind: 'team', teamId }. Team credit follows
 * the team chosen on the record, not whoever happens to be on the team today.
 */
export function inScope(it, scope) {
  if (!scope || scope.kind === 'org') return true;
  if (scope.kind === 'team') return it.team_id === scope.teamId;
  return true;
}

export const sessionRitualId = (rituals) => rituals.find((r) => r.applies_to_all)?.id ?? null;

const isDiscussion = (it, sessionId) => !!sessionId && it.ritual_id === sessionId;
const isPractice = (it, sessionId) =>
  !!it.system_category_id || (!!it.ritual_id && it.ritual_id !== sessionId);

/* ------------------------------------------------------ behavior of the week */

export const SEAL_TIERS = [
  { weeks: 4, tier: 1, name: 'One Month Kept' },
  { weeks: 12, tier: 2, name: 'One Quarter Kept' },
  { weeks: 26, tier: 3, name: 'Half Year Kept' },
  { weeks: 52, tier: 4, name: 'One Year Kept' }
];

/** The highest seal a run has earned, and how many months its notches show. */
export function sealFor(weeks) {
  let best = null;
  for (const t of SEAL_TIERS) if (weeks >= t.weeks) best = t;
  return { tier: best?.tier ?? 0, name: best?.name ?? null, months: Math.min(12, Math.floor(weeks / 4)) };
}

export function botwStreak(iterations, sessionId, scope, today = new Date()) {
  const logged = {};
  for (const it of iterations) {
    if (!isDiscussion(it, sessionId) || !inScope(it, scope)) continue;
    const k = weekKey(it.held_at);
    logged[k] = (logged[k] ?? 0) + 1;
  }
  const thisWeek = weekKey(today);
  let cursor = weekStart(today);
  if (!logged[thisWeek]) cursor = new Date(cursor.getTime() - 7 * DAY);
  let weeks = 0;
  while (logged[weekKey(cursor)]) { weeks++; cursor = new Date(cursor.getTime() - 7 * DAY); }

  const dots = lastWeeks(12, today).map((w, i, all) => ({
    key: weekKey(w), count: logged[weekKey(w)] ?? 0, current: i === all.length - 1
  }));
  return { weeks, dots, loggedThisWeek: !!logged[thisWeek], seal: sealFor(weeks) };
}

/* ---------------------------------------------------------------- practice */

/** Ritual and system runs, this week and across the recent window. */
export function practiceSummary(iterations, sessionId, scope, recentW, today = new Date()) {
  const thisWeek = weekKey(today);
  const since = lastWeeks(recentW, today)[0].getTime();
  const rows = iterations.filter((it) => isPractice(it, sessionId) && inScope(it, scope));
  return {
    thisWeek: rows.filter((it) => weekKey(it.held_at) === thisWeek),
    recent: rows.filter((it) => new Date(it.held_at).getTime() >= since)
  };
}

/** Per behavior: which of the recent weeks had a ritual or system run on it. */
export function practicedByBehavior(iterations, behaviors, sessionId, scope, recentW, today = new Date()) {
  const weeks = lastWeeks(recentW, today).map(weekKey);
  const hit = {};
  for (const it of iterations) {
    if (!isPractice(it, sessionId) || !inScope(it, scope)) continue;
    const k = weekKey(it.held_at);
    for (const b of it.behavior_ids ?? []) (hit[b] ??= new Set()).add(k);
  }
  return Object.fromEntries(behaviors.map((b) => {
    const marks = weeks.map((k) => !!hit[b.id]?.has(k));
    return [b.id, { marks, count: marks.filter(Boolean).length, of: recentW }];
  }));
}

/* --------------------------------------------------------------- connection */

/**
 * Someone on the team was recognized, or a story was shared, against this
 * behavior inside the recent window. Org scope counts anyone.
 */
export function connectionByBehavior(recognitions, stories, people, scope, recentDays, today = new Date()) {
  const since = today.getTime() - recentDays * DAY;
  const teamOf = Object.fromEntries(people.map((p) => [p.user_id, p.team_id]));
  const onTeam = (uid) => !!uid && teamOf[uid] === scope?.teamId;
  const out = {};
  const hit = (bid) => { out[bid] = true; };
  for (const r of recognitions) {
    if (new Date(r.created_at).getTime() < since) continue;
    if (scope?.kind === 'team' && !onTeam(r.recipient_user_id) && !onTeam(r.author_id)) continue;
    hit(r.behavior_id);
  }
  for (const s of stories) {
    if (new Date(s.created_at).getTime() < since) continue;
    if (scope?.kind === 'team' && !onTeam(s.author_id)) continue;
    hit(s.behavior_id);
  }
  return out;
}

/* ----------------------------------------------------------------- fluency */

export const FLUENCY_STEPS = [
  { key: 'description', label: (t) => `Read the full ${t.one} description`, section: 'Clarity' },
  { key: 'template', label: () => 'Read a ritual practice or a systems template', section: 'Clarity' },
  { key: 'botw', label: (t) => `You or your team recorded a ${t.One} of the Week discussion`, section: 'Cadence' },
  { key: 'practice', label: () => 'You or your team recorded a ritual or system practice', section: 'Cadence' }
];

/**
 * Four steps in any order make a person Foundation Fluent. A gold star for
 * the behavior, or a story they wrote about it, makes them Fully Fluent
 * whatever the ring says: someone else saw it, or they put it into words.
 */
export function fluencyFor(behavior, { marks, iterations, recognitions, stories, userId, teamId, sessionId }) {
  const mine = (it) => it.recorded_by === userId || (!!teamId && it.team_id === teamId);
  const covers = (it) => (it.behavior_ids ?? []).includes(behavior.id);
  const steps = {
    description: marks.some((m) => m.behavior_id === behavior.id && m.step === 'description'),
    template: marks.some((m) => m.behavior_id === behavior.id && m.step === 'template'),
    botw: iterations.some((it) => isDiscussion(it, sessionId) && covers(it) && mine(it)),
    practice: iterations.some((it) => isPractice(it, sessionId) && covers(it) && mine(it))
  };
  const star = recognitions.find((r) => r.behavior_id === behavior.id && r.recipient_user_id === userId);
  const story = stories.find((s) => s.behavior_id === behavior.id && s.author_id === userId);
  const done = Object.values(steps).filter(Boolean).length;
  return {
    steps, done, pct: done * 25,
    fluent: done === 4,
    full: !!(star || story),
    fullBy: star ? 'star' : story ? 'story' : null,
    fullRecord: star ? { kind: 'recognition', id: star.id } : story ? { kind: 'story', id: story.id } : null
  };
}

/* ------------------------------------------------------------ the full set */

/**
 * The all-Foundations capstone for a team or the organization: every active
 * behavior has been both discussed and practiced. Earned on the date the last
 * one was completed.
 */
export function fullSet(behaviors, iterations, sessionId, scope) {
  const active = behaviors.filter((b) => !b.is_example && !b.archived);
  const first = (pred, bid) => {
    let t = null;
    for (const it of iterations) {
      if (!pred(it, sessionId) || !inScope(it, scope) || !(it.behavior_ids ?? []).includes(bid)) continue;
      const x = new Date(it.held_at).getTime();
      if (t === null || x < t) t = x;
    }
    return t;
  };
  let covered = 0, latest = 0;
  const missing = [];
  for (const b of active) {
    const d = first(isDiscussion, b.id), p = first(isPractice, b.id);
    if (d !== null && p !== null) { covered++; latest = Math.max(latest, d, p); }
    else missing.push({ id: b.id, number: b.number, title: b.title, discussed: d !== null, practiced: p !== null });
  }
  const earned = active.length > 0 && covered === active.length;
  return { covered, total: active.length, earned, earnedAt: earned ? new Date(latest).toISOString() : null, missing };
}

/* ------------------------------------------------------------ survey cadence */

/**
 * The cairn fills from the bottom as the current pulse round gathers enough
 * answers; a full cairn marks a finished round. Stones are quarters of the
 * behaviors that have reached their answer target.
 */
export function cairnFor(status) {
  if (!status || !status.total) return { round: status?.round ?? 1, completed: 0, filled: 0, scored: 0, total: 0 };
  const completed = Math.max(0, (status.round ?? 1) - 1);
  return {
    round: status.round, completed,
    filled: Math.min(4, Math.floor((4 * status.scored) / status.total)),
    scored: status.scored, total: status.total
  };
}

/**
 * The spread between the highest and lowest scores narrowed from one finished
 * round to the next. Only finished rounds count; a round in progress would
 * move the answer every time someone signs in.
 */
export function gapClosed(spreads, currentRound) {
  const done = spreads.filter((r) => r.round < currentRound && r.responses > 0).sort((a, b) => a.round - b.round);
  if (done.length < 2) return { earned: false, rounds: done.length };
  const [prev, last] = done.slice(-2);
  return { earned: last.spread < prev.spread, from: prev.spread, to: last.spread, round: last.round, rounds: done.length };
}

/* ------------------------------------------------------------------- events */

/** Cadence and connection events per week, for the graph at the foot of a wall. */
export function weeklyEvents(iterations, recognitions, stories, people, scope, weeks, today = new Date()) {
  const keys = lastWeeks(weeks, today).map(weekKey);
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const cadence = keys.map(() => 0), connection = keys.map(() => 0);
  const teamOf = Object.fromEntries(people.map((p) => [p.user_id, p.team_id]));
  const onTeam = (uid) => scope?.kind !== 'team' || (!!uid && teamOf[uid] === scope.teamId);

  for (const it of iterations) {
    if (!inScope(it, scope)) continue;
    const i = idx[weekKey(it.held_at)];
    if (i !== undefined) cadence[i]++;
  }
  for (const r of recognitions) {
    if (!onTeam(r.author_id) && !onTeam(r.recipient_user_id)) continue;
    const i = idx[weekKey(r.created_at)];
    if (i !== undefined) connection[i]++;
  }
  for (const s of stories) {
    if (!onTeam(s.author_id)) continue;
    const i = idx[weekKey(s.created_at)];
    if (i !== undefined) connection[i]++;
  }
  return {
    labels: keys.map((k) => {
      const [y, m, d] = k.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }),
    cadence, connection
  };
}
