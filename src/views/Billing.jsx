import React, { useState } from 'react';
import {
  IS_LOCAL, choosePlan, startTrial, addPaymentMethod, manageBilling, cancelSubscription, resumeSubscription,
  setOverride, setBillingStatus, setBillingRates, advanceClock, setCardFails
} from '../lib/api.js';
import {
  billingNotices, PLAN_INFO, STATUS_LABEL, STATUS_TONE, OVERRIDE_LABEL,
  money, longDate, addDays, rateFor, TRIAL_DAYS, GRACE_DAYS
} from '../lib/billing.js';
import { Tag, Modal, confirmAction } from '../components/ui.jsx';


const EVENT_LABEL = {
  'trial-started': 'Free trial started',
  'plan-selected': 'Plan chosen',
  'card-added': 'Payment method added',
  'card-updated': 'Payment method updated',
  'card-removed': 'Payment method removed',
  payment: 'Payment received',
  'payment-failed': 'Payment failed',
  'payment-recorded': 'Payment date set by Horizon Line',
  'set-by-super': 'Changed by Horizon Line',
  'rates-set': 'Rates set by Horizon Line',
  'override-set': 'Arrangement set by Horizon Line',
  'override-cleared': 'Arrangement cleared',
  cancelled: 'Cancellation requested',
  resumed: 'Subscription resumed',
  notice: 'Notice emailed',
  active: 'Stripe: active', trialing: 'Stripe: trialing', past_due: 'Stripe: past due',
  canceled: 'Stripe: cancelled', unpaid: 'Stripe: unpaid'
};

function describe(e) {
  const d = e.detail ?? {};
  const bits = [];
  if (d.plan) bits.push(PLAN_INFO[d.plan]?.name ?? d.plan);
  if (d.cycle) bits.push(d.cycle);
  if (d.amount) bits.push(money(d.amount));
  if (d.paid_through) bits.push(`paid through ${d.paid_through}`);
  if (d.until) bits.push(`through ${d.until}`);
  if (d.kind && e.kind !== 'notice') bits.push(OVERRIDE_LABEL[d.kind] ?? d.kind);
  if (d.subject) bits.push(d.subject);
  if (d.last4) bits.push(`card ending ${d.last4}`);
  if (d.by) bits.push(d.by);
  return bits.join(' / ');
}

/** One line saying where the organization stands, with its key date. */
export function StatusLine({ billing }) {
  const s = billing.state;
  const plan = PLAN_INFO[s.plan]?.name ?? s.plan;
  let line = '';
  if (s.status === 'override') line = `${OVERRIDE_LABEL[s.kind] ?? 'Arranged'} through ${longDate(s.until)}`;
  else if (s.status === 'trial') line = `Free trial of the unlimited plan through ${longDate(s.until)}${billing.cycle ? `; keeping ${PLAN_INFO[billing.plan]?.name}, billed ${billing.cycle}` : '; no plan picked yet'}${s.card ? ', card on file' : ''}`;
  else if (s.status === 'active') line = `Paid through ${longDate(s.until)}, renews ${longDate(addDays(s.until, 1))}`;
  else if (s.status === 'cancelling') line = `Paid through ${longDate(s.until)}, then ends`;
  else if (s.status === 'grace') line = `Payment overdue, grace period to ${longDate(s.until)}`;
  else if (s.status === 'trial_ended') line = `Trial ended ${longDate(s.since)}`;
  else if (s.status === 'free') line = 'No plan chosen yet';
  else line = 'Only the culture champion has access';
  return (
    <div className="billstate">
      <span className="big">{s.full ? plan : 'Champion only'}</span>
      {billing.cycle && s.status !== 'override' && s.full && <span className="meta">Billed {billing.cycle}</span>}
      <Tag type={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Tag>
      <span className="meta">{line}</span>
    </div>
  );
}

/**
 * Plan and billing, for the culture champion. Admins see it too, read only.
 */
export function ChampionBilling({ ctx, billing, events, reload, toast }) {
  const { org, role, isSuper, refreshOrgs } = ctx;
  const [cycle, setCycle] = useState(billing.cycle ?? 'monthly');
  const [checkout, setCheckout] = useState(false);
  const canAct = role === 'champion' || isSuper;
  const s = billing.state;
  const notices = billingNotices(billing.org ?? org, billing.today);
  const override = s.status === 'override';
  const rates = billing.rates;
  const after = async (msg) => { if (msg) toast(msg); await refreshOrgs(); reload(); };

  async function pick(plan) {
    const price = money(rates[plan][cycle]);
    const per = cycle === 'yearly' ? 'year' : 'month';
    const same = plan === billing.plan && cycle === billing.cycle;
    if (same && billing.cycle) return toast('That is already your plan.');
    const inTrial = s.status === 'trial';
    const people = billing.total_people ?? billing.seats_used;
    const over = plan === 'small' ? Math.max(0, people - 9) : 0;
    const warning = over
      ? ` ${over} ${over === 1 ? 'person' : 'people'} will be inactivated ${inTrial ? 'when the trial ends and the plan starts' : 'right away'}, most recently added first. You can reactivate them by moving to Unlimited.`
      : '';
    const ok = await confirmAction({
      title: `Keep ${PLAN_INFO[plan].name}, billed ${cycle}?`,
      action: over ? `Keep it, inactivate ${over}` : 'Keep this plan', danger: !!over,
      body: (inTrial
        ? `You keep the unlimited plan until the trial ends ${longDate(s.until)}. Then ${price} a ${per}, plus any tax, once you add a payment method.`
        : `${price} a ${per}, plus any tax, from your next charge. Stripe credits any unused time on the old plan.`) + warning
    });
    if (!ok) return;
    try {
      const res = await choosePlan(org.id, { plan, cycle });
      await after(res?.inactivated ? `Plan set. ${res.inactivated} inactivated.` : inTrial ? 'Plan picked. Add a payment method to keep it after the trial.' : 'Plan changed.');
    } catch (e) { toast(e.message); }
  }

  async function beginTrial() {
    try {
      const res = await startTrial(org.id);
      await after(`Trial started. Unlimited people through ${longDate(res.trial_ends_at)}.`);
    } catch (e) { toast(e.message); }
  }

  async function payment() {
    if (IS_LOCAL) { setCheckout(true); return; }
    try { await addPaymentMethod(org.id); } catch (e) { toast(e.message); }
  }

  return (
    <>
      <section>
        <div className="sectionhead">
          <h2>Plan and billing</h2>
          <span className="note">{canAct ? 'You manage this as the culture champion' : 'Read only. The culture champion manages the plan.'}</span>
        </div>
        <StatusLine billing={billing} />
        <p className="meta">
          Seats in use: {billing.seats_used}{billing.seats_allowed ? ` of ${billing.seats_allowed}` : ', no limit'}.
          The culture champion always has access, whatever happens to the plan.
        </p>
        {notices.map((n) => (
          <div key={n.kind} className={n.level === 'warn' ? 'notice flagnotice' : 'notice infonotice'}>{n.text}</div>
        ))}
        {override && (
          <div className="notice infonotice">
            Your plan is arranged directly with Horizon Line Group
            {s.kind === 'invoiced' ? ' and invoiced outside the portal' : ''} through {longDate(s.until)}.
            There is nothing to pay here. Questions go to jon@horizonlinegroup.com.
          </div>
        )}
      </section>

      {!override && (
        <section>
          <div className="sectionhead">
            <h2>How it works</h2>
            <span className="note">{TRIAL_DAYS}-day free trial, then automatic renewal</span>
          </div>
          <ol className="howline">
            <li>Every portal starts with a {TRIAL_DAYS}-day free trial of the unlimited plan. No card, no choice to make.</li>
            <li>Before it ends, pick the plan you want to keep and add a payment method. Stripe takes the card and billing address and works out any sales tax.</li>
            <li>Billing starts the day after the trial and renews automatically. You get a reminder before each renewal and a receipt after each payment.</li>
            <li>No card by the end of the trial, or a payment that fails for {GRACE_DAYS} days, and access narrows to the culture champion. Nothing is ever deleted; adding a card brings everyone back.</li>
          </ol>
        </section>
      )}

      {!override && (
        <section>
          <div className="sectionhead">
            <h2>Options</h2>
            <span className="note">Both plans include everything</span>
          </div>
          {!billing.trial_used && billing.plan === 'free' && canAct && (
            <div className="notice infonotice cardline">
              <span>Start a {TRIAL_DAYS}-day free trial of the unlimited plan. No card and no plan to pick yet.</span>
              <button className="btn small" onClick={beginTrial}>Start the free trial</button>
            </div>
          )}
          <div className="termrow" role="group" aria-label="Billing term">
            <button className={cycle === 'monthly' ? 'btn small chosen' : 'btn ghost small'} onClick={() => setCycle('monthly')}>Monthly</button>
            <button className={cycle === 'yearly' ? 'btn small chosen' : 'btn ghost small'} onClick={() => setCycle('yearly')}>Yearly, w Discount</button>
          </div>
          <div className="plangrid">
            {['small', 'unlimited'].map((p) => {
              const mine = billing.plan === p && !!billing.cycle && (s.full || s.status === 'trial');
              return (
                <div key={p} className={mine ? 'plancard chosenplan' : 'plancard'}>
                  <h4>{PLAN_INFO[p].name}</h4>
                  <div className="planprices">
                    <div><span className="pp">{money(rates[p][cycle])}</span><span className="pl">per {cycle === 'yearly' ? 'year' : 'month'}, plus tax</span></div>
                  </div>
                  <ul className="feat">
                    {p === 'small'
                      ? <><li>Up to 9 people, you included</li><li>Right for a leadership team or a small company</li><li>Move up to Unlimited any time</li></>
                      : <><li>Everyone in the organization</li><li>Teams, team streaks and team awards at any size</li><li>The same price however many join</li></>}
                  </ul>
                  <div className="btnrow">
                    {canAct && (
                      <button className={mine && billing.cycle === cycle ? 'btn small chosen' : 'btn small'}
                        disabled={mine && billing.cycle === cycle} onClick={() => pick(p)}>
                        {mine && billing.cycle === cycle ? 'Your plan' : s.status === 'trial' ? 'Keep this plan' : 'Choose this plan'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!override && (billing.plan !== 'free' || billing.trial_used) && (
        <section>
          <div className="sectionhead"><h2>Payment</h2><span className="note">Handled by Stripe</span></div>
          <div className="rowlist">
            <div className="row">
              <div>
                <div className="t">{billing.has_payment_method ? `Card ending ${billing.card_last4 ?? 'on file'}` : 'No payment method yet'}</div>
                <div className="s">
                  {billing.has_payment_method
                    ? (s.status === 'trial'
                      ? `First charge ${longDate(addDays(s.until, 1))}: ${money(rateFor(billing.org ?? org))}, plus any tax.`
                      : s.status === 'active' ? `Next charge ${longDate(addDays(s.until, 1))}: ${money(rateFor(billing.org ?? org))}, plus any tax.` : 'Stripe retries automatically.')
                    : !billing.cycle ? 'Pick the plan you want to keep above, then add a payment method.'
                      : s.status === 'trial' ? `Add one before ${longDate(s.until)} to keep everyone's access.` : 'Add one to bring everyone back.'}
                </div>
              </div>
              <div className="rowactions">
                {canAct && (
                  <button className="btn small" onClick={payment} disabled={!billing.cycle}
                    title={billing.cycle ? undefined : 'Pick the plan you want to keep first'}>
                    {billing.has_payment_method ? 'Update card' : 'Add a payment method'}
                  </button>
                )}
                {canAct && !IS_LOCAL && billing.has_payment_method && (
                  <button className="btn ghost small" onClick={() => manageBilling(org.id).catch((e) => toast(e.message))}>Invoices and receipts</button>
                )}
              </div>
            </div>
          </div>
          {canAct && (
            <div className="btnrow">
              {billing.cancel_at_period_end ? (
                <button className="btn ghost small" onClick={async () => {
                  try { await resumeSubscription(org.id); await after('Resumed. It renews as normal.'); } catch (e) { toast(e.message); }
                }}>Resume subscription</button>
              ) : (s.status === 'active' || (s.status === 'trial' && billing.has_payment_method)) && (
                <button className="btn ghost small danger" onClick={async () => {
                  if (!(await confirmAction({
                    title: s.status === 'trial' ? 'Cancel before the trial turns into a charge?' : 'Cancel at the end of the paid period?',
                    body: s.status === 'trial'
                      ? `Everyone keeps access through ${longDate(s.until)}, then it narrows to the culture champion. Nothing is charged.`
                      : `Everyone keeps access through ${longDate(s.until)}, then it narrows to the culture champion. Nothing is deleted.`,
                    action: 'Cancel subscription'
                  }))) return;
                  try { const r = await cancelSubscription(org.id); await after(`Cancelled. Access continues through ${longDate(r?.until ?? s.until)}.`); }
                  catch (e) { toast(e.message); }
                }}>Cancel subscription</button>
              )}
            </div>
          )}
        </section>
      )}

      <BillingHistory events={events} />

      {checkout && (
        <DemoCheckout org={billing.org ?? org} billing={billing} toast={toast}
          onClose={() => setCheckout(false)}
          onDone={async () => { setCheckout(false); await after('Payment method saved.'); }} />
      )}
    </>
  );
}

function BillingHistory({ events }) {
  if (!events?.length) return null;
  return (
    <section>
      <div className="sectionhead"><h2>Billing history</h2><span className="note">Most recent first</span></div>
      <div className="rowlist">
        {events.map((e) => (
          <div key={e.id} className="row">
            <div>
              <div className="t">{EVENT_LABEL[e.kind] ?? e.kind}</div>
              <div className="s">{e.day ? longDate(e.day) : new Date(e.at).toLocaleDateString()}{describe(e) ? ` / ${describe(e)}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Local stand-in for Stripe Checkout, so the flow can be walked through
 * without a server. The hosted build goes to Stripe's own page instead.
 */
function DemoCheckout({ org, billing, toast, onClose, onDone }) {
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [fails, setFails] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = billing.state;
  const price = rateFor(org);
  const firstDay = s.status === 'trial' ? addDays(s.until, 1) : billing.today;

  async function save() {
    const digits = card.replace(/\D/g, '');
    if (digits.length < 12) return toast('Enter a card number. The demo accepts 4242 4242 4242 4242.');
    setBusy(true);
    try { await addPaymentMethod(org.id, { last4: digits.slice(-4), fails }); onDone(); }
    catch (e) { toast(e.message); setBusy(false); }
  }

  return (
    <Modal title="Stripe Checkout (demo)" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : s.status === 'trial' ? 'Save card' : 'Pay and subscribe'}</button>
      </>}>
      <p className="meta">
        In the live portal this is Stripe's own secure page. It collects the card and the billing
        address, and Stripe calculates sales tax from that address.
      </p>
      <div className="stripebox">
        <div className="srow"><span>{PLAN_INFO[org.plan]?.name}, billed {org.billing_cycle}</span><span>{money(price)}</span></div>
        <div className="srow"><span>Sales tax</span><span>Calculated by Stripe</span></div>
        <div className="srow total">
          <span>{s.status === 'trial' ? `Due today` : 'Due today, plus tax'}</span>
          <span>{s.status === 'trial' ? '$0' : money(price)}</span>
        </div>
        {s.status === 'trial' && <div className="meta">First charge on {longDate(firstDay)}, then every {org.billing_cycle === 'yearly' ? 'year' : 'month'}.</div>}
      </div>
      <label className="fl">Card number</label>
      <input type="text" value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" />
      <label className="toggle" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={fails} onChange={(e) => setFails(e.target.checked)} />
        <span className="meta" style={{ margin: 0 }}>Demo only: use a card that will decline, to see the grace period.</span>
      </label>
    </Modal>
  );
}

/**
 * The super user's controls for one organization: its rates, any field of
 * its billing, and an arrangement that wins over Stripe.
 */
export function SuperBilling({ ctx, billing, events, reload, toast }) {
  const { org, refreshOrgs } = ctx;
  const o = billing.org ?? org;
  const [ov, setOv] = useState({
    kind: billing.override?.kind ?? '', plan: billing.override?.plan ?? 'unlimited',
    until: billing.override?.until ?? '', note: billing.override?.note ?? ''
  });
  const after = async (msg) => { if (msg) toast(msg); await refreshOrgs(); reload(); };
  const setField = async (fields, msg) => {
    try { await setBillingStatus(org.id, fields); await after(msg); } catch (e) { toast(e.message); }
  };
  const rate = async (fields) => {
    try { await setBillingRates(org.id, fields); await after('Rate saved.'); } catch (e) { toast(e.message); }
  };

  return (
    <>
      <section>
        <div className="sectionhead"><h2>Billing for {org.name}</h2><span className="note">Super user only</span></div>
        <StatusLine billing={billing} />
        <p className="meta">
          An arrangement below wins over anything Stripe reports until its end date. Everything else is
          worked out from the fields underneath it, which Stripe keeps up to date and which you can set by hand.
        </p>
      </section>

      <section>
        <div className="sectionhead"><h2>Arrangement</h2><span className="note">Overrides Stripe</span></div>
        <div className="panel">
          <div className="overridegrid">
            <div>
              <label className="fl">Kind</label>
              <select className="field" value={ov.kind} onChange={(e) => setOv({ ...ov, kind: e.target.value })}>
                <option value="">None, follow Stripe</option>
                <option value="invoiced">Invoiced outside Stripe</option>
                <option value="extension">Extend the expiration date</option>
              </select>
            </div>
            <div>
              <label className="fl">Plan while it lasts</label>
              <select className="field" value={ov.plan} disabled={!ov.kind} onChange={(e) => setOv({ ...ov, plan: e.target.value })}>
                <option value="small">Up to 9 people</option>
                <option value="unlimited">Unlimited people</option>
              </select>
            </div>
            <div>
              <label className="fl">Through</label>
              <input type="date" value={ov.until} disabled={!ov.kind} onChange={(e) => setOv({ ...ov, until: e.target.value })} />
            </div>
          </div>
          <label className="fl">Note, for your records</label>
          <input type="text" value={ov.note} disabled={!ov.kind} onChange={(e) => setOv({ ...ov, note: e.target.value })}
            placeholder="Invoice 2026-114, net 30" />
          <div className="btnrow">
            <button className="btn small" onClick={async () => {
              try {
                await setOverride(org.id, ov.kind ? ov : { kind: null });
                await after(ov.kind ? `Arrangement saved through ${longDate(ov.until)}.` : 'Arrangement cleared. Stripe decides again.');
              } catch (e) { toast(e.message); }
            }}>{ov.kind ? 'Save arrangement' : 'Clear arrangement'}</button>
          </div>
        </div>
      </section>

      <section>
        <div className="sectionhead"><h2>Rates</h2><span className="note">This organization's own prices</span></div>
        <div className="settinggrid">
          {['small', 'unlimited'].map((p) => (
            <div key={p} className="panel">
              <h4 className="paneltitle">{PLAN_INFO[p].name}</h4>
              <div className="tworow">
                <div>
                  <label className="fl">Monthly</label>
                  <input type="text" defaultValue={billing.rates[p].monthly} onBlur={(e) => rate({ [`rate_${p}_monthly`]: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="fl">Yearly</label>
                  <input type="text" defaultValue={billing.rates[p].yearly} onBlur={(e) => rate({ [`rate_${p}_yearly`]: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="meta">A new rate applies from the next charge. Stripe is sent the price at checkout and on each plan change.</p>
      </section>

      <section>
        <div className="sectionhead"><h2>Payment terms</h2><span className="note">Set any field by hand</span></div>
        <div className="settinggrid">
          <div className="panel">
            <label className="fl">Plan</label>
            <select className="field" value={o.plan ?? 'free'} onChange={(e) => setField({ plan: e.target.value }, 'Plan set.')}>
              <option value="free">None, champion only</option>
              <option value="small">Up to 9 people</option>
              <option value="unlimited">Unlimited people</option>
            </select>
            <label className="fl">Billed</label>
            <select className="field" value={o.billing_cycle ?? ''} onChange={(e) => setField({ billing_cycle: e.target.value || null }, 'Term set.')}>
              <option value="">Not set</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="panel">
            <label className="fl">Trial ends</label>
            <input type="date" defaultValue={o.trial_ends_at ?? ''} key={'t' + o.trial_ends_at}
              onChange={(e) => setField({ trial_ends_at: e.target.value || null, trial_used: true }, 'Trial end set.')} />
            <label className="fl">Paid through</label>
            <input type="date" defaultValue={o.paid_through ?? ''} key={'p' + o.paid_through}
              onChange={(e) => setField({ paid_through: e.target.value || null }, 'Paid-through date set.')} />
          </div>
          <div className="panel">
            <label className="toggle">
              <input type="checkbox" checked={!!o.cancel_at_period_end}
                onChange={(e) => { const v = e.target.checked; setField({ cancel_at_period_end: v }, v ? 'Set to end at the paid-through date.' : 'Set to renew.'); }} />
              <span>Ends at the paid-through date instead of renewing</span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={!o.trial_used}
                onChange={(e) => { const v = e.target.checked; setField({ trial_used: !v }, v ? 'They can start a fresh trial.' : 'Trial marked as used.'); }} />
              <span>Allow a fresh {TRIAL_DAYS}-day trial</span>
            </label>
            <p className="meta">Changing a date here does not change what Stripe charges. For that, use the Stripe dashboard, or an arrangement above.</p>
          </div>
        </div>
      </section>

      {IS_LOCAL && (
        <section>
          <div className="demobox">
            <label className="fl">Demo clock. Local only: move today forward to watch trials end, renewals charge and notices go out.</label>
            <div className="btnrow" style={{ marginTop: 6 }}>
              <span className="meta" style={{ margin: 0, alignSelf: 'center' }}>Today is {longDate(billing.today)}{billing.clock_offset ? ` (${billing.clock_offset} days ahead)` : ''}</span>
              {[1, 7, 30].map((d) => (
                <button key={d} className="btn ghost small" onClick={async () => { await advanceClock(d); await after(`Moved ahead ${d} day${d > 1 ? 's' : ''}.`); }}>+{d} day{d > 1 ? 's' : ''}</button>
              ))}
              {billing.clock_offset !== 0 && (
                <button className="btn ghost small" onClick={async () => { await advanceClock(null); await after('Back to the real date.'); }}>Back to today</button>
              )}
              {billing.has_payment_method && (
                <button className="btn ghost small" onClick={async () => { await setCardFails(org.id, !billing.card_fails); await after(billing.card_fails ? 'The card works again.' : 'The card will now decline.'); }}>
                  {billing.card_fails ? 'Make the card work' : 'Make the card decline'}
                </button>
              )}
            </div>
            <p className="meta">Emails the portal would send show in the Email outbox on this organization's Admin page.</p>
          </div>
        </section>
      )}

      <BillingHistory events={events} />
    </>
  );
}
