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

/* ---------------------------------------------------------------- cadence */
/*
 * The behavior of the week turns over on the organization's cadence, and the
 * streaks count in the same unit:
 *   daily    each weekday (Saturday and Sunday belong to Friday)
 *   weekly   Monday to Sunday
 *   monthly  from a chosen day of the month (1 to 28) to the day before it
 */

export function cadenceOf(org) {
  const kind = ['daily', 'weekly', 'monthly'].includes(org?.botw_cadence) ? org.botw_cadence : 'weekly';
  const day = Math.min(28, Math.max(1, Number(org?.botw_day) || 1));
  return { kind, day };
}

const WEEKLY = { kind: 'weekly', day: 1 };

export const UNIT = {
  daily: { one: 'day', many: 'days', this: 'today', every: 'each weekday' },
  weekly: { one: 'week', many: 'weeks', this: 'this week', every: 'each Monday' },
  monthly: { one: 'month', many: 'months', this: 'this month', every: 'each month' }
};

const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;

/** "Rotates each weekday", "Rotates Mondays", "Rotates on the 15th". */
export function rotationNote(cad) {
  if (cad.kind === 'daily') return 'Rotates each weekday';
  if (cad.kind === 'monthly') return `Rotates on the ${ordinal(cad.day)} of each month`;
  return 'Rotates Monday';
}

export function periodStart(d = new Date(), cad = WEEKLY) {
  if (cad.kind === 'weekly') return weekStart(d);
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  if (cad.kind === 'daily') {
    const dow = x.getDay();
    if (dow === 6) x.setDate(x.getDate() - 1);
    if (dow === 0) x.setDate(x.getDate() - 2);
    return x;
  }
  if (x.getDate() < cad.day) x.setMonth(x.getMonth() - 1);
  x.setDate(cad.day);
  return x;
}

export function prevPeriod(start, cad = WEEKLY) {
  const x = new Date(start);
  if (cad.kind === 'weekly') return new Date(x.getTime() - 7 * DAY);
  if (cad.kind === 'daily') {
    x.setDate(x.getDate() - 1);
    return periodStart(x, cad);
  }
  x.setMonth(x.getMonth() - 1);
  return x;
}

const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
export const periodKey = (d, cad = WEEKLY) => ymd(periodStart(d, cad));

/** The last n period starts, oldest first, ending with the current one. */
export function lastPeriods(n, cad = WEEKLY, today = new Date()) {
  const out = [periodStart(today, cad)];
  while (out.length < n) out.unshift(prevPeriod(out[0], cad));
  return out;
}

/** How many periods the organization's recent window spans. */
export function recentPeriods(org) {
  const cad = cadenceOf(org);
  const days = org?.recent_days ?? 45;
  if (cad.kind === 'daily') return Math.max(1, Math.round((days * 5) / 7));
  if (cad.kind === 'monthly') return Math.max(1, Math.round(days / 30));
  return Math.max(1, Math.round(days / 7));
}

/** Rotation steps owed between the last change and today. */
export function periodsBetween(from, to = new Date(), cad = WEEKLY) {
  const start = periodStart(from, cad).getTime();
  let cursor = periodStart(to, cad), n = 0;
  while (cursor.getTime() > start && n < 5000) { cursor = prevPeriod(cursor, cad); n++; }
  return n;
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

/** Periods in a month of each cadence, so the seals mean the same span of time. */
const PER_MONTH = { daily: 21, weekly: 4, monthly: 1 };
const TIER_MONTHS = [1, 3, 6, 12];

/** The highest seal a run has earned, and how many months its notches show. */
export function sealFor(count, cad = WEEKLY) {
  const per = PER_MONTH[cad.kind] ?? 4;
  let best = null;
  SEAL_TIERS.forEach((t, i) => { if (count >= TIER_MONTHS[i] * per) best = t; });
  return {
    tier: best?.tier ?? 0, name: best?.name ?? null,
    months: Math.min(12, Math.floor(count / per)),
    first: per // periods to the first seal
  };
}

export function botwStreak(iterations, sessionId, scope, today = new Date(), cad = WEEKLY) {
  const logged = {};
  for (const it of iterations) {
    if (!isDiscussion(it, sessionId) || !inScope(it, scope)) continue;
    const k = periodKey(it.held_at, cad);
    logged[k] = (logged[k] ?? 0) + 1;
  }
  const current = periodKey(today, cad);
  // The period in progress never breaks a streak; it adds to it once logged.
  let cursor = periodStart(today, cad);
  if (!logged[current]) cursor = prevPeriod(cursor, cad);
  let count = 0;
  while (logged[ymd(cursor)] && count < 5000) { count++; cursor = prevPeriod(cursor, cad); }

  const dots = lastPeriods(12, cad, today).map((w, i, all) => ({
    key: ymd(w), count: logged[ymd(w)] ?? 0, current: i === all.length - 1
  }));
  // `weeks` is kept as the name of the count for older screens; `unit` says what it counts.
  return { weeks: count, count, unit: UNIT[cad.kind], cad, dots, loggedThisWeek: !!logged[current], seal: sealFor(count, cad) };
}

/* ---------------------------------------------------------------- practice */

/** Ritual and system runs, this week and across the recent window. */
export function practiceSummary(iterations, sessionId, scope, recentW, today = new Date(), cad = WEEKLY) {
  const current = periodKey(today, cad);
  const since = lastPeriods(recentW, cad, today)[0].getTime();
  const rows = iterations.filter((it) => isPractice(it, sessionId) && inScope(it, scope));
  return {
    thisWeek: rows.filter((it) => periodKey(it.held_at, cad) === current),
    recent: rows.filter((it) => new Date(it.held_at).getTime() >= since)
  };
}

/** Per behavior: which of the recent weeks had a ritual or system run on it. */
export function practicedByBehavior(iterations, behaviors, sessionId, scope, recentW, today = new Date(), cad = WEEKLY) {
  const weeks = lastPeriods(recentW, cad, today).map(ymd);
  const hit = {};
  for (const it of iterations) {
    if (!isPractice(it, sessionId) || !inScope(it, scope)) continue;
    const k = periodKey(it.held_at, cad);
    for (const b of it.behavior_ids ?? []) (hit[b] ??= new Set()).add(k);
  }
  return Object.fromEntries(behaviors.map((b) => {
    const marks = weeks.map((k) => !!hit[b.id]?.has(k));
    return [b.id, { marks, count: marks.filter(Boolean).length, of: recentW, cad }];
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
  { key: 'practice', label: () => 'You or your team recorded a ritual or system practice', section: 'Cadence' },
  { key: 'rated', label: (t) => `You rated this ${t.one} in a quick pulse`, section: 'Conviction' }
];

/**
 * Five steps in any order, rating it in a pulse among them, make a person Foundation Fluent. A gold star for
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
    practice: iterations.some((it) => isPractice(it, sessionId) && covers(it) && mine(it)),
    // Rated at least once, in any pulse round. Arrives as a mark from the backend.
    rated: marks.some((m) => m.behavior_id === behavior.id && m.step === 'rated')
  };
  const star = recognitions.find((r) => r.behavior_id === behavior.id && r.recipient_user_id === userId);
  const story = stories.find((s) => s.behavior_id === behavior.id && s.author_id === userId);
  const done = Object.values(steps).filter(Boolean).length;
  const of = FLUENCY_STEPS.length;
  return {
    steps, done, of, pct: Math.round((done / of) * 100),
    fluent: done === of,
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
 * The cairn fills from the bottom as members finish the current round: a
 * round is complete when 80% of members have rated every behavior. Stones
 * are quarters of that target; a full cairn marks a finished round.
 */
export function cairnFor(status) {
  const pct = status?.pct ?? 80;
  if (!status || !status.total) return { round: status?.round ?? 1, completed: 0, filled: 0, done: 0, target: 0, total: 0, mineLeft: 0, pct };
  // Rounds closed on record; older backends only knew the round number.
  const completed = status.closed ?? Math.max(0, (status.round ?? 1) - 1);
  const done = status.done ?? status.scored ?? 0;
  const target = status.target || 1;
  // How much of the round is rated: every rating in, against every active
  // member rating every behavior. Older backends only knew who had finished.
  const complete = status.complete ?? Math.round((100 * done) / target);
  return {
    round: status.round, completed, pct, complete,
    rated: status.rated ?? null, possible: status.possible ?? null,
    // The four stones fill with the share rated, the top one at 100%.
    filled: Math.min(4, Math.floor((4 * complete) / 100)),
    done, target, members: status.members ?? target, total: status.total,
    mineLeft: status.mine_left ?? 0,
    // kept for older screens
    scored: done
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
