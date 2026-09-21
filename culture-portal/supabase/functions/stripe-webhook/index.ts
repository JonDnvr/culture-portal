// supabase/functions/stripe-webhook/index.ts
// Writes Stripe's view of each subscription back onto the organization, so the
// app can answer one question cheaply: is this organization's payment current?
//
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   stripe listen --forward-to https://YOUR-PROJECT.functions.supabase.co/stripe-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

async function applySubscription(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.org_id;
  if (!orgId) return;

  // Anything other than active or trialing means access falls back to the
  // free tier, which is the champion alone.
  const current = ['active', 'trialing'].includes(sub.status);

  await admin.from('organizations').update({
    stripe_subscription_id: sub.id,
    plan: current ? (sub.metadata?.plan ?? 'small') : 'free',
    billing_cycle: sub.metadata?.cycle ?? null,
    // paid_through is the single source of truth for "is this current".
    paid_through: current ? day(sub.current_period_end) : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    // A confirmed payment is what clears a pending plan change.
    pending_change: current ? null : undefined
  }).eq('id', orgId);

  await admin.from('billing_events').insert({
    org_id: orgId, kind: sub.status, stripe_id: sub.id,
    detail: { plan: sub.metadata?.plan, cycle: sub.metadata?.cycle, period_end: sub.current_period_end }
  });
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Signature check failed: ${e instanceof Error ? e.message : e}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          // Checkout metadata is the reliable copy; carry it onto the subscription.
          await stripe.subscriptions.update(sub.id, { metadata: session.metadata ?? {} });
          await applySubscription({ ...sub, metadata: session.metadata ?? {} } as Stripe.Subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          await applySubscription(sub);
        }
        break;
      }
      default:
        break;
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (e) {
    return new Response(`Handler failed: ${e instanceof Error ? e.message : e}`, { status: 500 });
  }
});
