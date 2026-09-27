// supabase/functions/stripe-webhook/index.ts
// Writes Stripe's view of each subscription back onto the organization.
// Completed payments set the paid-through date and send a receipt; the
// access rules (billing.js, access_state in the database) do the rest.
// A super user override is never touched here: it wins whatever Stripe says.
//
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   Stripe dashboard > Developers > Webhooks > Add endpoint:
//     https://scypggscxntpaakdjelr.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//     customer.subscription.updated, customer.subscription.deleted,
//     invoice.paid, invoice.payment_failed

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { isoDay, addDays, receiptEmail } from '../_shared/billing.js';
import { sendBillingEmail, championEmail } from '../_shared/email.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const day = (unix: number) => isoDay(unix * 1000);
/** Stripe's period end is the moment the next period starts; the day before is the last day paid for. */
const lastDay = (unix: number) => addDays(day(unix), -1);

async function orgIdFor(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.org_id) return sub.metadata.org_id;
  const { data } = await admin.from('organizations').select('id').eq('stripe_customer_id', sub.customer as string).maybeSingle();
  return data?.id ?? null;
}

async function cardLast4(sub: Stripe.Subscription): Promise<string | null> {
  const pm = sub.default_payment_method;
  if (!pm) return null;
  try {
    const m = typeof pm === 'string' ? await stripe.paymentMethods.retrieve(pm) : pm;
    return (m as Stripe.PaymentMethod).card?.last4 ?? null;
  } catch { return null; }
}

async function applySubscription(sub: Stripe.Subscription, extra: Record<string, unknown> = {}) {
  const orgId = await orgIdFor(sub);
  if (!orgId) return;
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const update: Record<string, unknown> = {
    stripe_subscription_id: sub.status === 'canceled' ? null : sub.id,
    stripe_customer_id: sub.customer as string,
    subscription_status: sub.status,
    cancel_at_period_end: sub.status === 'canceled' ? true : !!sub.cancel_at_period_end,
    has_payment_method: live && !!sub.default_payment_method,
    ...extra
  };
  const last4 = await cardLast4(sub);
  if (last4) update.card_last4 = last4;
  if (sub.metadata?.plan) update.plan = sub.metadata.plan;
  if (sub.metadata?.cycle) update.billing_cycle = sub.metadata.cycle;
  if (sub.status === 'trialing' && sub.trial_end) update.trial_ends_at = lastDay(sub.trial_end);
  // An active period that Stripe has been paid for moves paid-through on.
  if (sub.status === 'active' && sub.current_period_end) update.paid_through = lastDay(sub.current_period_end);

  await admin.from('organizations').update(update).eq('id', orgId);
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
          await stripe.subscriptions.update(sub.id, { metadata: { ...sub.metadata, ...(session.metadata ?? {}) } });
          await applySubscription({ ...sub, metadata: { ...sub.metadata, ...(session.metadata ?? {}) } } as Stripe.Subscription,
            { has_payment_method: true });
          const orgId = session.metadata?.org_id;
          if (orgId) await admin.from('billing_events').insert({ org_id: orgId, kind: 'card-added', stripe_id: session.id, detail: {} });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription || !invoice.amount_paid) break;   // the $0 invoice that opens a trial
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        await applySubscription(sub);
        const orgId = await orgIdFor(sub);
        if (!orgId) break;
        const paidThrough = lastDay(sub.current_period_end);
        const amount = invoice.amount_paid / 100;
        // The plan they kept now sets the seats; extra people go inactive.
        await admin.rpc('enforce_seats', { p_org: orgId });
        await admin.from('billing_events').insert({
          org_id: orgId, kind: 'payment', stripe_id: invoice.id,
          detail: { amount, tax: (invoice.tax ?? 0) / 100, paid_through: paidThrough, plan: sub.metadata?.plan, cycle: sub.metadata?.cycle }
        });
        const { data: org } = await admin.from('organizations').select('*').eq('id', orgId).single();
        const to = await championEmail(admin, orgId);
        if (org && to) {
          const r = receiptEmail(org, { amount: amount - (invoice.tax ?? 0) / 100, paidThrough });
          await sendBillingEmail([to], r.subject,
            r.body + (invoice.hosted_invoice_url ? `\n\nStripe receipt and invoice: ${invoice.hosted_invoice_url}` : ''));
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        await applySubscription(sub);
        const orgId = await orgIdFor(sub);
        if (orgId) {
          await admin.from('billing_events').insert({
            org_id: orgId, kind: 'payment-failed', stripe_id: invoice.id, detail: { amount: invoice.amount_due / 100 }
          });
        }
        // The grace-period email goes out from billing-notices, once.
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
