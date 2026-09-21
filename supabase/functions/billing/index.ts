// supabase/functions/billing/index.ts
// Stripe Checkout and subscription management for the two paid tiers.
//
//   supabase functions deploy billing
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
//
// The companion webhook lives in supabase/functions/stripe-webhook. Rates are
// per organization, so prices are created ad hoc rather than pulled from a
// fixed Stripe price catalogue.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PLANS: Record<string, { name: string; monthly: string; yearly: string }> = {
  small: { name: 'Culture Portal, up to 9 people', monthly: 'rate_small_monthly', yearly: 'rate_small_yearly' },
  unlimited: { name: 'Culture Portal, unlimited people', monthly: 'rate_unlimited_monthly', yearly: 'rate_unlimited_yearly' }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { action, orgId, plan, cycle, returnUrl } = await req.json();

    // Only a champion of that organization, or the super user, may spend money.
    const { data: superRow } = await admin
      .from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    const { data: membership } = await admin
      .from('memberships').select('org_id, role').eq('user_id', user.id).maybeSingle();

    const allowed = !!superRow ||
      (membership?.org_id === orgId && ['champion', 'owner'].includes(membership.role));
    if (!allowed) return json({ error: 'Only a culture champion can manage billing' }, 403);

    const { data: org } = await admin.from('organizations').select('*').eq('id', orgId).single();
    if (!org) return json({ error: 'No such organization' }, 404);

    if (action === 'checkout') {
      const spec = PLANS[plan];
      if (!spec) return json({ error: 'Unknown plan' }, 400);
      if (cycle !== 'monthly' && cycle !== 'yearly') return json({ error: 'Unknown billing cycle' }, 400);

      const amount = Number(org[spec[cycle]] ?? 0);
      if (!amount) return json({ error: 'No rate is set for that plan. Ask the super user to set one.' }, 400);

      let customerId = org.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: org.name, metadata: { org_id: orgId }
        });
        customerId = customer.id;
        await admin.from('organizations').update({ stripe_customer_id: customerId }).eq('id', orgId);
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(amount * 100),
            recurring: { interval: cycle === 'yearly' ? 'year' : 'month' },
            product_data: { name: spec.name }
          }
        }],
        // Recurring until cancelled; the webhook keeps paid_through in step.
        subscription_data: { metadata: { org_id: orgId, plan, cycle } },
        success_url: `${returnUrl}?billing=success`,
        cancel_url: `${returnUrl}?billing=cancelled`,
        metadata: { org_id: orgId, plan, cycle }
      });

      return json({ url: session.url, id: session.id });
    }

    if (action === 'cancel') {
      if (!org.stripe_subscription_id) return json({ error: 'No active subscription' }, 400);
      // Cancel at period end, so the organization keeps what it paid for.
      await stripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: true });
      await admin.from('organizations').update({ cancel_at_period_end: true }).eq('id', orgId);
      return json({ ok: true, cancel_at_period_end: true });
    }

    if (action === 'resume') {
      if (!org.stripe_subscription_id) return json({ error: 'No active subscription' }, 400);
      await stripe.subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: false });
      await admin.from('organizations').update({ cancel_at_period_end: false }).eq('id', orgId);
      return json({ ok: true, cancel_at_period_end: false });
    }

    if (action === 'portal') {
      if (!org.stripe_customer_id) return json({ error: 'No customer record yet' }, 400);
      const portal = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id, return_url: returnUrl
      });
      return json({ url: portal.url });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
