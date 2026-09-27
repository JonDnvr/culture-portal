/**
 * Who has access, and what to tell the culture champion about it.
 *
 * One definition, used by the local backend, the Admin screens and the
 * banners. The database (access_state in schema.sql) and the daily notices
 * function (supabase/functions/billing-notices) apply the same rules; if
 * one changes, change all three.
 *
 * Order of precedence:
 *   1. A super user override that has not run out wins over everything,
 *      including whatever Stripe reports.
 *   2. Paid through a date that has not passed: active (or cancelling).
 *   3. Inside the 30-day trial: full access, card or no card.
 *   4. A paid period that ran out without a cancellation: 7 days of grace.
 *   5. Anything else: the culture champion alone. Data is never deleted.
 */

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 7;
export const TRIAL_WARN_DAYS = 7;

/** What a new organization is quoted until the super user sets its own rates. */
export const DEFAULT_RATES = {
  small: { monthly: 15, yearly: 159 },
  unlimited: { monthly: 49, yearly: 499 }
};

export const PLAN_INFO = {
  free: { id: 'free', name: 'Champion only', seats: 1 },
  small: { id: 'small', name: 'Up to 9 people', seats: 9 },
  unlimited: { id: 'unlimited', name: 'Unlimited people', seats: Infinity }
};

export const OVERRIDE_LABEL = {
  invoiced: 'Invoiced outside Stripe',
  extension: 'Expiration extended'
};

const DAY = 86400000;

/** A plain yyyy-mm-dd, compared as text. */
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoDay(new Date(iso + 'T12:00:00Z').getTime() + n * DAY);
export const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(toIso + 'T12:00:00Z') - new Date(fromIso + 'T12:00:00Z')) / DAY);

/** The last day a period starting on `startIso` covers, a month or a year on. */
export function periodEnd(startIso, cycle) {
  const d = new Date(startIso + 'T12:00:00Z');
  if (cycle === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return addDays(isoDay(d), -1);
}

export function rateFor(org, plan = org?.plan, cycle = org?.billing_cycle) {
  if (!plan || plan === 'free' || !cycle) return 0;
  return Number(org?.[`rate_${plan}_${cycle}`] ?? 0);
}

export const money = (n) =>
  `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const longDate = (iso) => (iso
  ? new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  : '');

/**
 * The organization's access today.
 *   status: override | active | cancelling | trial | grace | trial_ended | lapsed | ended | free
 *   full:   everyone on the plan can sign in (the champion always can)
 *   plan:   the plan that sets the seat count while access is full
 *   until:  the last day of the current state, when it has one
 */
export function accessState(org, today) {
  if (!org) return { status: 'free', full: false, plan: 'free' };
  const t = today;
  const plan = org.plan || 'free';

  if (org.override_kind && org.override_until && org.override_until >= t) {
    return {
      status: 'override', full: true, kind: org.override_kind,
      plan: org.override_plan || (plan === 'free' ? 'unlimited' : plan), until: org.override_until
    };
  }
  if (plan === 'free') return { status: 'free', full: false, plan: 'free' };

  if (org.paid_through && org.paid_through >= t) {
    return { status: org.cancel_at_period_end ? 'cancelling' : 'active', full: true, plan, until: org.paid_through };
  }
  if (org.trial_ends_at && org.trial_ends_at >= t) {
    // Everyone gets the unlimited plan during the trial, whatever they pick to
    // keep. The picked plan's seat limit applies once it is paid for.
    return {
      status: 'trial', full: true, plan: 'unlimited', chosen: plan, until: org.trial_ends_at,
      daysLeft: daysBetween(t, org.trial_ends_at), card: !!org.has_payment_method
    };
  }
  if (org.paid_through && !org.cancel_at_period_end) {
    const graceEnd = addDays(org.paid_through, GRACE_DAYS);
    if (graceEnd >= t) return { status: 'grace', full: true, plan, until: graceEnd, since: org.paid_through };
    return { status: 'lapsed', full: false, plan, since: graceEnd };
  }
  if (org.paid_through) return { status: 'ended', full: false, plan, since: org.paid_through };
  if (org.trial_ends_at) return { status: 'trial_ended', full: false, plan, since: org.trial_ends_at };
  return { status: 'lapsed', full: false, plan };
}

/** The plan whose seat count applies right now. */
export const effectivePlan = (org, today) => {
  const s = accessState(org, today);
  return s.full ? s.plan : 'free';
};

export const STATUS_LABEL = {
  override: 'Arranged by Horizon Line',
  active: 'Active',
  cancelling: 'Cancelled, running to its end date',
  trial: 'Free trial',
  grace: 'Payment overdue, grace period',
  trial_ended: 'Trial ended',
  lapsed: 'Not current',
  ended: 'Ended',
  free: 'Champion only'
};

/** Tag color for a status: category is sage (good), warn is red. */
export const STATUS_TONE = {
  override: 'category', active: 'category', cancelling: 'warn', trial: 'live',
  grace: 'warn', trial_ended: 'warn', lapsed: 'warn', ended: 'warn', free: 'plain'
};

/**
 * What the champion should know today, most urgent first. Shown on Admin and
 * in the banner; the same wording goes out by email on the schedule below.
 */
export function billingNotices(org, today) {
  const s = accessState(org, today);
  const out = [];
  const price = money(rateFor(org, org.plan));
  const cycleWord = org.billing_cycle === 'yearly' ? 'year' : 'month';

  if (s.status === 'trial') {
    if (!org.billing_cycle) {
      out.push({ level: s.daysLeft <= TRIAL_WARN_DAYS ? 'warn' : 'info', kind: 'trial-pick', text:
        `Free trial of the unlimited plan through ${longDate(s.until)}. Pick the plan you want to keep and add a payment method before then, or access returns to the culture champion only. Nothing is deleted.` });
    } else if (!s.card && s.daysLeft <= TRIAL_WARN_DAYS) {
      out.push({ level: 'warn', kind: 'trial-ending', text:
        `Your free trial ends ${longDate(s.until)} (${s.daysLeft === 0 ? 'today' : `in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`}). ` +
        'Add a payment method before then, or access returns to the culture champion only. Nothing is deleted.' });
    } else if (!s.card) {
      out.push({ level: 'info', kind: 'trial', text:
        `Free trial through ${longDate(s.until)}. Add a payment method any time before then; you are not charged until the trial ends.` });
    } else {
      out.push({ level: 'info', kind: 'trial-card', text:
        `Free trial through ${longDate(s.until)}. Your card is on file; the first charge of ${price} a ${cycleWord}, plus any tax, is on ${longDate(addDays(s.until, 1))}.` });
    }
  }
  if (s.status === 'trial_ended') {
    out.push({ level: 'warn', kind: 'trial-ended', text:
      `The free trial ended ${longDate(s.since)}. Only the culture champion has access now. Add a payment method to bring everyone back; nothing was deleted.` });
  }
  if (s.status === 'active') {
    const left = daysBetween(today, s.until);
    const window = org.billing_cycle === 'yearly' ? 30 : 7;
    if (left <= window) {
      out.push({ level: 'info', kind: 'renewal', text:
        `Renews ${longDate(addDays(s.until, 1))} for ${price} a ${cycleWord}, plus any tax, charged to the card on file.` });
    }
  }
  if (s.status === 'cancelling') {
    out.push({ level: 'warn', kind: 'cancelling', text:
      `Cancelled. Everyone keeps access through ${longDate(s.until)}, then it returns to the culture champion only. Resume any time before then.` });
  }
  if (s.status === 'grace') {
    out.push({ level: 'warn', kind: 'grace', text:
      `The payment due ${longDate(addDays(s.since, 1))} did not go through. Update the card by ${longDate(s.until)} to keep everyone's access.` });
  }
  if (s.status === 'lapsed' || s.status === 'ended') {
    out.push({ level: 'warn', kind: s.status, text:
      'The subscription is not current. Only the culture champion has access. Choose a plan and add a payment method to bring everyone back; nothing was deleted.' });
  }
  return out;
}

/**
 * Emails due today, each with a key that makes it go out once. The daily job
 * and the local demo clock both send whatever this returns and record the
 * key.
 */
export function noticesDue(org, today) {
  const s = accessState(org, today);
  const due = [];
  const at = (kind, anchor) => ({ kind, key: `${kind}:${anchor}` });

  if (s.status === 'trial' && !s.card && s.daysLeft <= TRIAL_WARN_DAYS) due.push(at('trial-7', org.trial_ends_at));
  if (s.status === 'trial_ended') due.push(at('trial-ended', org.trial_ends_at));
  if (s.status === 'active') {
    const left = daysBetween(today, s.until);
    const marks = org.billing_cycle === 'yearly' ? [30, 7, 1] : [7, 1];
    for (const m of marks) if (left <= m) { due.push(at(`renewal-${m}`, s.until)); break; }
  }
  if (s.status === 'cancelling') {
    const left = daysBetween(today, s.until);
    for (const m of [7, 1]) if (left <= m) { due.push(at(`expiring-${m}`, s.until)); break; }
  }
  if (s.status === 'grace') due.push(at('grace', s.since));
  if (s.status === 'lapsed' || s.status === 'ended') due.push(at('locked', s.since ?? 'none'));
  return due;
}

/** Subject and body for each notice email. */
export function noticeEmail(kind, org, today) {
  const s = accessState(org, today);
  const price = money(rateFor(org, org.plan));
  const cycleWord = org.billing_cycle === 'yearly' ? 'year' : 'month';
  const base = kind.replace(/-\d+$/, '');
  const sign = '\n\nOpen the portal, then Admin, then Plan and billing.\n\nHorizon Line Group';
  const map = {
    trial: [`${org.name}: your free trial ends ${longDate(s.until)}`,
      `Your 30-day trial of the culture portal ends ${longDate(s.until)}.\n\nAdd a payment method before then so everyone keeps access. You are not charged until the trial ends: ${price} a ${cycleWord}, plus any tax.\n\nIf you do not, access returns to you, the culture champion, alone. Nothing is deleted.`],
    'trial-ended': [`${org.name}: your free trial has ended`,
      `The trial ended ${longDate(s.since)}. Only the culture champion can sign in now.\n\nAdd a payment method to bring everyone back. Your content is all still there.`],
    renewal: [`${org.name}: your plan renews ${longDate(addDays(s.until ?? today, 1))}`,
      `Your ${PLAN_INFO[s.plan]?.name ?? ''} plan renews ${longDate(addDays(s.until ?? today, 1))} for ${price} a ${cycleWord}, plus any tax, charged to the card on file.\n\nTo change the plan or the card, or to cancel, use Plan and billing.`],
    expiring: [`${org.name}: access ends ${longDate(s.until)}`,
      `Your subscription was cancelled and runs through ${longDate(s.until)}. After that only the culture champion can sign in.\n\nResume any time before then to keep everyone's access.`],
    grace: [`${org.name}: payment did not go through`,
      `The payment due ${longDate(addDays(s.since ?? today, 1))} did not go through. Update the card by ${longDate(s.until)} to keep everyone's access.`],
    locked: [`${org.name}: access is limited to the culture champion`,
      `The subscription is no longer current, so only the culture champion can sign in. Nothing was deleted.\n\nChoose a plan and add a payment method to bring everyone back.`]
  };
  const [subject, body] = map[base] ?? [`${org.name}: billing notice`, 'There is a change to your plan.'];
  return { subject, body: body + sign };
}

export function receiptEmail(org, { amount, paidThrough }) {
  return {
    subject: `${org.name}: payment received`,
    body: `Thank you. We received ${money(amount)} for the ${PLAN_INFO[org.plan]?.name ?? ''} plan, plus any tax on the Stripe receipt.\n\n` +
      `Your organization is paid through ${longDate(paidThrough)}. It renews automatically; you will get a reminder before it does.` +
      '\n\nHorizon Line Group'
  };
}
