// supabase/functions/billing/index.ts
// Everything the culture champion does with the plan: choose it (the first
// time starts the 30-day trial), add a card through Stripe Checkout, open
// Stripe's customer page, cancel and resume.
//
//   supabase functions deploy billing
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_...
//
// Rates are per organization, so each organization gets its own Stripe
// price, found again by lookup key rather than created every time. Stripe
// Tax works out the tax from the billing address Checkout collects.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { TRIAL_DAYS, PLAN_INFO, accessState, addDays, isoDay } from '../_shared/billing.js';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });

// Stripe's tax code for software as a service, business use. Check it in the
// Stripe dashboard (Product catalog, Tax code) before going live.
const TAX_CODE = Deno.env.get('STRIPE_TAX_CODE') ?? 'txcd_10103001';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

/** One product per plan, shared by every organization. */
async function productFor(plan: string) {
  const id = `culture-portal-${plan}`;
  try { return await stripe.products.retrieve(id); }
  catch {
    return await stripe.products.create({
      id, name: `Culture Portal, ${PLAN_INFO[plan].name.toLowerCase()}`, tax_code: TAX_CODE
    });
  }
}

/** This organization's price for a plan and term, created once and reused. */
async function priceFor(org: any, plan: string, cycle: string) {
  const amount = Number(org[`rate_${plan}_${cycle}`] ?? 0);
  if (!amount) throw new Error('No rate is set for that plan. Ask Horizon Line to set one.');
  const cents = Math.round(amount * 100);
  const lookup_key = `cp_${org.id}_${plan}_${cycle}_${cents}`;
  const found = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 });
  if (found.data[0]) return found.data[0];
  const product = await productFor(plan);
  return await stripe.prices.create({
    product: product.id, currency: 'usd', unit_amount: cents, lookup_key,
    tax_behavior: 'exclusive',
    recurring: { interval: cycle === 'yearly' ? 'year' : 'month' },
    metadata: { org_id: org.id, plan, cycle }
  });
}

async function log(orgId: string, kind: string, detail: unknown, stripeId?: string) {
  await admin.from('billing_events').insert({ org_id: orgId, kind, detail, stripe_id: stripeId ?? null });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { action, orgId, plan, cycle, returnUrl } = await req.json();

    // Only the culture champion of that organization, or the super user.
    const { data: superRow } = await admin.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    const { data: membership } = await admin.from('memberships').select('org_id, role, display_name').eq('user_id', user.id).maybeSingle();
    const allowed = !!superRow || (membership?.org_id === orgId && ['champion', 'owner'].includes(membership.role));
    if (!allowed) return json({ error: 'Only the culture champion can change the plan or payment.' }, 403);
    const by = membership?.display_name ?? 'Horizon Line';

    const { data: org } = await admin.from('organizations').select('*').eq('id', orgId).single();
    if (!org) return json({ error: 'No such organization' }, 404);
    const today = isoDay(Date.now());

    /* ------------------------------------------------ choose a plan and term */
    if (action === 'choose-plan') {
      if (!['small', 'unlimited'].includes(plan)) return json({ error: 'Pick one of the two plans.' }, 400);
      if (!['monthly', 'yearly'].includes(cycle)) return json({ error: 'Pick monthly or yearly.' }, 400);
      // Picking a smaller plan is allowed with too many people; the newest go
      // inactive when the plan applies (now, or at the end of the trial).
      const update: Record<string, unknown> = { plan, billing_cycle: cycle, cancel_at_period_end: false };
      const trialStarted = false;

      // With a subscription already running, Stripe moves it to the new price
      // and credits unused time on the old one.
      if (org.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(org.subscription_status ?? '')) {
        const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
        const price = await priceFor(org, plan, cycle);
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: sub.items.data[0].id, price: price.id }],
          proration_behavior: 'create_prorations',
          cancel_at_period_end: false,
          metadata: { org_id: orgId, plan, cycle }
        });
      }

      await admin.from('organizations').update(update).eq('id', orgId);
      await log(orgId, 'plan-selected', { plan, cycle, by });
      const { data: seats } = await admin.rpc('enforce_seats', { p_org: orgId });
      return json({ trialStarted, trial_ends_at: org.trial_ends_at, ...(seats ?? {}) });
    }

    /* ------------------------------ a trial for an org that never had one */
    if (action === 'start-trial') {
      if (org.trial_used) return json({ error: 'This organization has already had its free trial.' }, 400);
      const until = addDays(today, TRIAL_DAYS - 1);
      await admin.from('organizations').update({
        plan: 'unlimited', billing_cycle: null, trial_used: true, trial_ends_at: until
      }).eq('id', orgId);
      await admin.rpc('enforce_seats', { p_org: orgId });
      await log(orgId, 'trial-started', { plan: 'unlimited', until, by });
      return json({ trial_ends_at: until });
    }

    /* --------------------------------- add a card: Stripe Checkout, with tax */
    if (action === 'checkout') {
      if (!org.plan || org.plan === 'free' || !org.billing_cycle) return json({ error: 'Choose a plan first.' }, 400);

      // A running subscription already has a card; change it on Stripe's page.
      if (org.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(org.subscription_status ?? '')) {
        const portal = await stripe.billingPortal.sessions.create({ customer: org.stripe_customer_id, return_url: returnUrl });
        return json({ url: portal.url });
      }

      let customerId = org.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({ name: org.name, email: user.email, metadata: { org_id: orgId } });
        customerId = customer.id;
        await admin.from('organizations').update({ stripe_customer_id: customerId }).eq('id', orgId);
      }

      const price = await priceFor(org, org.plan, org.billing_cycle);
      const state = accessState(org, today);
      // Billing waits for the trial to end. Stripe needs the trial end at
      // least two days out; closer than that, billing starts today.
      const trialEnd = state.status === 'trial'
        ? Math.floor(new Date(addDays(org.trial_ends_at, 1) + 'T06:00:00Z').getTime() / 1000)
        : null;
      const useTrial = trialEnd && trialEnd - Date.now() / 1000 > 49 * 3600;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        customer_update: { address: 'auto', name: 'auto' },
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        automatic_tax: { enabled: true },
        payment_method_collection: 'always',
        line_items: [{ price: price.id, quantity: 1 }],
        subscription_data: {
          metadata: { org_id: orgId, plan: org.plan, cycle: org.billing_cycle },
          ...(useTrial ? { trial_end: trialEnd } : {})
        },
        metadata: { org_id: orgId, plan: org.plan, cycle: org.billing_cycle },
        success_url: `${returnUrl}?billing=success`,
        cancel_url: `${returnUrl}?billing=cancelled`
      });
      return json({ url: session.url, id: session.id });
    }

    /* ------------------------------------------ Stripe's own customer page */
    if (action === 'portal') {
      if (!org.stripe_customer_id) return json({ error: 'No payment method yet.' }, 400);
      const portal = await stripe.billingPortal.sessions.create({ customer: org.stripe_customer_id, return_url: returnUrl });
      return json({ url: portal.url });
    }

    if (action === 'cancel') {
      if (!org.stripe_subscription_id) return json({ error: 'No active subscription' }, 400);
      // At period end (or trial end), so the organization keeps what it paid for.
      await stripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: true });
      await admin.from('organizations').update({ cancel_at_period_end: true }).eq('id', orgId);
      await log(orgId, 'cancelled', { until: org.paid_through ?? org.trial_ends_at, by });
      return json({ ok: true, cancel_at_period_end: true, until: org.paid_through ?? org.trial_ends_at });
    }

    if (action === 'resume') {
      if (!org.stripe_subscription_id) return json({ error: 'No active subscription' }, 400);
      await stripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: false });
      await admin.from('organizations').update({ cancel_at_period_end: false }).eq('id', orgId);
      await log(orgId, 'resumed', { plan: org.plan, cycle: org.billing_cycle, by });
      return json({ ok: true, cancel_at_period_end: false });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
