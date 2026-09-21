import React, { useState, useEffect } from 'react';
import {
  createSystemCategory, deleteSystemCategory, listMembers,
  createUser, updateUserRole, removeUser, resetUserPassword,
  createOrganization, listAllOrganizations,
  updateOrganization, setWeeklyBehavior, setRecentWindow, setPulseCount, updateSystemCategory,
  createValue, updateValue, deleteValue,
  listMeasures, createMeasure, updateMeasure, deleteMeasure,
  getBilling, setBillingRates, setBillingStatus, startCheckout, cancelSubscription, resumeSubscription,
  listBillingEvents, listAccessRequests, approveRequest, declineRequest,
  clearExampleContent, listOutbox, setAutoAdvance, IS_LOCAL
} from '../lib/api.js';
import { pad, Tag, Modal, useToast } from '../components/ui.jsx';

const money = (n) => (n || n === 0 ? `$${Number(n).toLocaleString()}` : '—');

const ROLES = [
  { id: 'member', label: 'Member', can: 'Reads everything, posts recognition and stories, answers the pulse' },
  { id: 'leader', label: 'Leader', can: 'The above, plus records iterations and sees Conviction' },
  { id: 'admin', label: 'Admin', can: 'The above, plus edits content and manages people. Several people can hold this.' },
  { id: 'champion', label: 'Culture champion', can: 'Admin rights, and the one seat that keeps working if the subscription lapses. Only one person holds it.' }
];

export default function Admin({ ctx }) {
  const { org, isSuper, behaviors, systems, values,
    reload, openBehavior, refreshOrgs, switchOrg } = ctx;
  const [members, setMembers] = useState([]);
  const [name, setName] = useState('');
  const [modal, setModal] = useState(null);
  const [allOrgs, setAllOrgs] = useState([]);
  const [measures, setMeasures] = useState([]);
  const [billing, setBilling] = useState(null);
  const toast = useToast();

  const [billingEvents, setBillingEvents] = useState([]);
  const loadBilling = () => {
    getBilling(org.id).then(setBilling).catch(() => setBilling(null));
    listBillingEvents(org.id).then(setBillingEvents).catch(() => setBillingEvents([]));
  };
  useEffect(() => { loadBilling(); }, [org.id]);

  const loadMeasures = () => listMeasures(org.id).then(setMeasures).catch(() => setMeasures([]));
  useEffect(() => { loadMeasures(); }, [org.id]);

  const [requests, setRequests] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [showMail, setShowMail] = useState(null);

  const loadMembers = () => {
    listMembers(org.id).then(setMembers).catch((e) => toast(e.message));
    listAccessRequests(org.id).then(setRequests).catch(() => setRequests([]));
    listOutbox(org.id).then(setOutbox).catch(() => setOutbox([]));
  };
  useEffect(() => { loadMembers(); }, [org.id]);
  useEffect(() => {
    if (isSuper) listAllOrganizations().then(setAllOrgs).catch(() => setAllOrgs([]));
  }, [isSuper, org.id]);

  async function addCategory() {
    if (!name.trim()) return toast('Name the category first.');
    try {
      await createSystemCategory(org.id, name.trim(), systems.length + 1);
      setName(''); toast('Category added.'); reload();
    } catch (e) { toast(e.message); }
  }

  async function changeRole(userId, role) {
    try { await updateUserRole(userId, role); toast('Role updated.'); loadMembers(); }
    catch (e) { toast(e.message); }
  }

  async function drop(userId, who) {
    if (!window.confirm(`Remove ${who}? Their stories and recognition stay in the record.`)) return;
    try { await removeUser(userId); toast('Person removed.'); loadMembers(); }
    catch (e) { toast(e.message); }
  }

  const usage = (s) => behaviors.filter((b) => b.placements.some((p) => p.systemId === s.id)).length;

  // A super user starts on their own tab, since that is why they switched in.
  const [tab, setTab] = useState(isSuper ? 'super' : 'org');

  return (
    <>
      <div className="dateline">{isSuper ? 'Super user, all organizations' : `Culture champion, ${org.name}`}</div>
      <h1 className="pagetitle">Admin</h1>
      <p className="lede">People and roles, purpose, values, system categories and measures for {org.name}. Behaviors and rituals are managed from Cadence.</p>

      {isSuper && <AdminTabs tab={tab} setTab={setTab} orgName={org.name} />}

      {isSuper && tab === 'super' && (
        <SuperAdmin ctx={ctx} billing={billing} billingEvents={billingEvents} allOrgs={allOrgs}
          reloadBilling={loadBilling} toast={toast} />
      )}

      {(!isSuper || tab === 'org') && (
      <>

      <section>
        <div className="sectionhead">
          <h2>Purpose and identity</h2>
          <span className="note"><button className="btn small" onClick={() => setModal({ kind: 'purpose' })}>Edit</button></span>
        </div>
        <div className="rowlist">
          <div className="row"><div><div className="t">Name</div><div className="s">{org.name}{org.subtitle ? ` / ${org.subtitle}` : ''}</div></div></div>
          <div className="row"><div><div className="t">Shared purpose/mission</div><div className="s">{org.mission || 'Not written yet'}</div></div></div>
          <div className="row"><div><div className="t">Vision/Where we are going</div><div className="s">{org.vision || 'Not written yet'}</div></div></div>
          <div className="row"><div><div className="t">Creed</div><div className="s">{org.creed || 'Not written yet'}</div></div></div>
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>Behavior of the week</h2>
          <span className="note">Shown on the culture home and in Cadence</span>
        </div>
        <div className="panel" style={{ maxWidth: 560 }}>
          <label className="fl" htmlFor="weekSel">Currently practising</label>
          <select id="weekSel" className="field" value={org.weekly_behavior_id ?? ''}
            onChange={async (e) => {
              try {
                await setWeeklyBehavior(org.id, e.target.value || null);
                toast('Behavior of the week set.');
                await refreshOrgs(); reload();
              } catch (err) { toast(err.message); }
            }}>
            <option value="">None selected</option>
            {behaviors.map((b) => <option key={b.id} value={b.id}>{pad(b.number)}. {b.title}</option>)}
          </select>
          <label className="switchrow">
            <input type="checkbox" checked={!!org.auto_advance}
              onChange={async (e) => {
                try {
                  await setAutoAdvance(org.id, e.target.checked);
                  toast(e.target.checked
                    ? 'It will now move on by itself each week.'
                    : 'Back to setting it by hand.');
                  await refreshOrgs(); reload();
                } catch (err) { toast(err.message); }
              }} />
            <span>Advance automatically each week, in rotation order</span>
          </label>
          <p className="meta" style={{ marginTop: 8 }}>
            {org.auto_advance
              ? 'It moves to the next behavior in the rotation a week after the last change. Setting one by hand restarts the clock.'
              : 'Set it each week.'}
          </p>
          {staleWeek(org) && (
            <div className="notice flagnotice" style={{ marginTop: 10 }}>
              This was last changed {staleWeek(org)} days ago. The rotation has stalled.
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>Values</h2>
          <span className="note"><button className="btn small" onClick={() => setModal({ kind: 'value' })}>Add a value</button></span>
        </div>
        <div className="rowlist">
          {values.map((v) => {
            const carried = behaviors.filter((b) => b.values.some((x) => x.id === v.id)).length;
            return (
              <div key={v.id} className="row">
                <div><div className="t">{v.name}</div><div className="s">{v.description}</div></div>
                <div className="rowactions">
                  <span className={carried ? 'tag' : 'tag warn'}>{carried} behavior{carried === 1 ? '' : 's'}</span>
                  <button className="btn ghost small" onClick={() => setModal({ kind: 'value', v })}>Edit</button>
                  <button className="btn ghost small" onClick={async () => {
                    if (!window.confirm(`Delete the value "${v.name}"? Behaviors keep their other values.`)) return;
                    try { await deleteValue(v.id); toast('Value deleted.'); reload(); } catch (e) { toast(e.message); }
                  }}>Delete</button>
                </div>
              </div>
            );
          })}
          {!values.length && <div className="row"><div className="s">No values yet.</div></div>}
        </div>
      </section>

      {org.has_example_content && (
        <section>
          <div className="sectionhead">
            <h2>Example content</h2>
            <span className="note">
              <button className="btn small" onClick={async () => {
                if (!window.confirm('Delete everything still marked as an example?')) return;
                try { await clearExampleContent(org.id); toast('Example content cleared.'); await refreshOrgs(); reload(); }
                catch (e) { toast(e.message); }
              }}>Clear example content</button>
            </span>
          </div>
          <div className="notice">
            This portal still has example values and behaviors, marked with an Example tag
            wherever they appear. Editing one clears its tag; this button removes whatever is left.
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section>
          <div className="sectionhead">
            <h2>Tentative members</h2>
            <span className="note">Requests ({requests.length})</span>
          </div>
          <div className="rowlist">
            {requests.map((r) => (
              <div key={r.id} className="row">
                <div>
                  <div className="t">{r.name}</div>
                  <div className="s">
                    {r.email} / asked {new Date(r.at).toLocaleDateString()}
                    {r.note ? ` / ${r.note}` : ''}
                  </div>
                </div>
                <div className="rowactions">
                  <select className="field inline" defaultValue="member" id={`role-${r.id}`}>
                    {ROLES.filter((x) => x.id !== 'champion').map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </select>
                  <button className="btn small" onClick={async () => {
                    const role = document.getElementById(`role-${r.id}`)?.value ?? 'member';
                    try {
                      await approveRequest(r.id, role);
                      toast(`${r.name} is active, and has the welcome email.`);
                      loadMembers();
                    } catch (e) { toast(e.message); }
                  }}>Make active</button>
                  <button className="btn ghost small" onClick={async () => {
                    if (!window.confirm(`Decline ${r.name}?`)) return;
                    try { await declineRequest(r.id); toast('Request declined.'); loadMembers(); }
                    catch (e) { toast(e.message); }
                  }}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="sectionhead">
          <h2>People</h2>
          <span className="note">
            <button className="btn small" onClick={() => setModal({ kind: 'invite' })}>Add a person</button>
          </span>
        </div>
        <div className="rowlist">
          {members.map((m) => (
            <div key={m.id} className="row">
              <div>
                <div className="t">{m.display_name}</div>
                <div className="s">{m.email}</div>
              </div>
              <div className="rowactions">
                <select className="field inline" value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value)}>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  {m.role === 'owner' && <option value="owner">Super user</option>}
                </select>
                <button className="btn ghost small" onClick={() => setModal({ kind: 'password', m })}>Password</button>
                <button className="btn ghost small" onClick={() => drop(m.user_id, m.display_name)}>Remove</button>
              </div>
            </div>
          ))}
          {!members.length && <div className="row"><div className="s">Nobody here yet.</div></div>}
        </div>
        <div className="notice">
          A person belongs to one organization and sees only its data. Roles are assigned here, never
          chosen by the person holding them. {isSuper ? 'Only you can assign the super user role.' : 'Only the super user can assign the super user role.'}
        </div>
      </section>

      <section>
        <div className="sectionhead"><h2>What each role can do</h2></div>
        <div className="rowlist">
          {ROLES.map((r) => (
            <div key={r.id} className="row">
              <div><div className="t">{r.label}</div><div className="s">{r.can}</div></div>
              <span className="tag">{members.filter((m) => m.role === r.id).length}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="sectionhead"><h2>System categories</h2><span className="note">Set here, then applied to behaviors</span></div>
        <div className="rowlist">
          {systems.map((s) => (
            <div key={s.id} className="row">
              <div><div className="t">{s.name}</div><div className="s">{usage(s)} behavior{usage(s) === 1 ? '' : 's'} applied</div></div>
              <div className="rowactions">
                <button className="btn ghost small" onClick={() => setModal({ kind: 'system', s })}>Rename</button>
                <button className="btn ghost small" disabled={usage(s) > 0}
                  onClick={async () => { await deleteSystemCategory(s.id); toast('Category removed.'); reload(); }}>
                  {usage(s) > 0 ? 'In use' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel" style={{ marginTop: 12, maxWidth: 440 }}>
          <label className="fl">Add a system category</label>
          <input type="text" placeholder="Performance reviews, compensation, offboarding"
            value={name} onChange={(e) => setName(e.target.value)} />
          <div className="btnrow"><button className="btn" onClick={addCategory}>Add category</button></div>
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>Measures</h2>
          <span className="note"><button className="btn small" onClick={() => setModal({ kind: 'measure' })}>Add a measure</button></span>
        </div>
        <p className="prose">
          Define what the behaviors are meant to move. Recording a value for each period is a
          separate job, done from Conviction so it can happen on a cycle.
        </p>
        <div className="rowlist">
          {measures.map((m) => (
            <div key={m.id} className="row">
              <div><div className="t">{m.name}</div><div className="s">{m.note}</div></div>
              <div className="rowactions">
                <button className="btn ghost small" onClick={() => setModal({ kind: 'measure', m })}>Edit</button>
                <button className="btn ghost small" onClick={async () => {
                  if (!window.confirm(`Delete "${m.name}"? Recorded values for it go too.`)) return;
                  try { await deleteMeasure(m.id); toast('Measure deleted.'); loadMeasures(); } catch (e) { toast(e.message); }
                }}>Delete</button>
              </div>
            </div>
          ))}
          {!measures.length && <div className="row"><div className="s">No measures defined yet.</div></div>}
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>Settings</h2>
          <span className="note">Applies to everyone in {org.name}</span>
        </div>
        <div className="settinggrid">
          <div className="panel">
            <label className="fl" htmlFor="recentSel">What counts as recent</label>
            <select id="recentSel" className="field" value={org.recent_days ?? 45}
              onChange={async (e) => {
                try { await setRecentWindow(org.id, Number(e.target.value)); toast('Recent window set.'); await refreshOrgs(); reload(); }
                catch (err) { toast(err.message); }
              }}>
              {[14, 30, 45, 60, 90, 180].map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
            <p className="meta">Used on behavior pages and in Conviction.</p>
          </div>

          <div className="panel">
            <label className="fl" htmlFor="pulseSel">Quick pulse per sign-in</label>
            <select id="pulseSel" className="field" value={org.pulse_per_signin ?? 2}
              onChange={async (e) => {
                try { await setPulseCount(org.id, Number(e.target.value)); toast('Pulse size set.'); await refreshOrgs(); reload(); }
                catch (err) { toast(err.message); }
              }}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} behavior{n === 1 ? '' : 's'}</option>)}
            </select>
            <p className="meta">How many behaviors a person is asked to rate when they sign in.</p>
          </div>

          <div className="panel">
            <label className="fl" htmlFor="accent">Highlight color</label>
            <AccentPicker org={org} toast={toast} refreshOrgs={refreshOrgs} />
            <p className="meta">Pick it or type a hex value. Applies everywhere immediately.</p>
          </div>
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>Plan and billing</h2>
          <span className="note">
            {billing && (billing.expiring
              ? <Tag type="warn">Expires {billing.paid_through}</Tag>
              : billing.current
                ? <Tag type="category">Current</Tag>
                : billing.plan === 'free' ? <Tag type="plain">Free tier</Tag> : <Tag type="warn">Not current</Tag>)}
          </span>
        </div>
        {billing ? (
          <>
            <div className="rowlist">
              <div className="row">
                <div>
                  <div className="t">{PLAN_LABEL[billing.plan] ?? billing.plan}</div>
                  <div className="s">
                    {billing.cycle ? `Billed ${billing.cycle}` : 'No subscription'}
                    {billing.paid_through ? ` / paid through ${billing.paid_through}` : ''}
                  </div>
                </div>
                <div className="rowactions">
                  <Tag type={billing.seats_allowed && billing.seats_used > billing.seats_allowed ? 'warn' : 'plain'}>
                    Seats ({billing.seats_used}{billing.seats_allowed ? ` of ${billing.seats_allowed}` : ', unlimited'})
                  </Tag>
                </div>
              </div>
            </div>

            {billing.pending_change && (
              <div className="notice">
                Plan change recorded {new Date(billing.pending_change.at).toLocaleDateString()} by{' '}
                {billing.pending_change.by}: {PLAN_LABEL[billing.pending_change.plan]}, billed{' '}
                {billing.pending_change.cycle}. Waiting on payment confirmation; your paid-through
                date is unchanged{billing.paid_through ? ` at ${billing.paid_through}` : ''}.
              </div>
            )}
            {billing.expiring && (
              <div className="notice flagnotice">
                Cancelled. The subscription stays active until {billing.paid_through}, then the
                organization falls back to the free tier, which is the culture champion alone.
              </div>
            )}
            {billing.lapsed && !billing.expiring && (
              <div className="notice flagnotice">
                The subscription is not current. You keep your content and the champion keeps
                access; everyone else is locked out until it is renewed.
              </div>
            )}

            <div className="plangrid">
              <PlanCard id="small" name="Up to 9 people"
                monthly={billing.rates.small.monthly} yearly={billing.rates.small.yearly}
                active={billing.plan === 'small'} cycle={billing.cycle} current={billing.current}
                onChoose={async (cycle) => {
                  const label = cycle === 'yearly' ? 'yearly' : 'monthly';
                  if (!window.confirm(
                    `Switch to Up to 9 people, billed ${label}?\n\n` +
                    'The subscription is not active until it is paid. You keep your content and the ' +
                    'champion keeps access; everyone else gains access once payment is recorded by our admin.'
                  )) return;
                  try {
                    await startCheckout(org.id, { plan: 'small', cycle });
                    toast('Plan recorded. Horizon Line confirms the payment before the date changes.');
                    await refreshOrgs(); loadBilling();
                  } catch (e) { toast(e.message); }
                }} />
              <PlanCard id="unlimited" name="Unlimited people"
                monthly={billing.rates.unlimited.monthly} yearly={billing.rates.unlimited.yearly}
                active={billing.plan === 'unlimited'} cycle={billing.cycle} current={billing.current}
                onChoose={async (cycle) => {
                  const label = cycle === 'yearly' ? 'yearly' : 'monthly';
                  if (!window.confirm(
                    `Switch to Unlimited people, billed ${label}?\n\n` +
                    'The subscription is not active until it is paid. You keep your content and the ' +
                    'champion keeps access; everyone else gains access once payment is recorded by our admin.'
                  )) return;
                  try {
                    await startCheckout(org.id, { plan: 'unlimited', cycle });
                    toast('Plan recorded. Horizon Line confirms the payment before the date changes.');
                    await refreshOrgs(); loadBilling();
                  } catch (e) { toast(e.message); }
                }} />
            </div>
            <p className="meta">
              The culture champion is always on the free tier and keeps access whatever happens to
              the subscription. Paid seats cover everyone else.
            </p>
            {billing.plan !== 'free' && (
              <div className="btnrow">
                {billing.cancel_at_period_end ? (
                  <button className="btn ghost small" onClick={async () => {
                    if (!window.confirm(
                      'Resume this subscription?\n\n' +
                      'This records your intent. The paid-through date does not change until the next payment is confirmed.'
                    )) return;
                    try {
                      await resumeSubscription(org.id);
                      toast('Resume recorded. Horizon Line confirms the next payment.');
                      await refreshOrgs(); loadBilling();
                    } catch (e) { toast(e.message); }
                  }}>Resume subscription</button>
                ) : billing.current && (
                  <button className="btn ghost small" onClick={async () => {
                    if (!window.confirm('Cancel at the end of the paid period? Access continues until then.')) return;
                    try {
                      const res = await cancelSubscription(org.id);
                      toast(`Cancelled. Access continues until ${res?.until ?? billing.paid_through}.`);
                      await refreshOrgs(); loadBilling();
                    } catch (e) { toast(e.message); }
                  }}>Cancel subscription</button>
                )}
              </div>
            )}
          </>
        ) : <div className="empty">Billing is not available for this organization.</div>}
      </section>

      {IS_LOCAL && outbox.length > 0 && (
        <section>
          <div className="sectionhead">
            <h2>Email outbox</h2>
            <span className="note">Local mode only, nothing is actually sent ({outbox.length})</span>
          </div>
          <div className="rowlist">
            {outbox.slice(0, 8).map((m) => (
              <div key={m.id} className="row">
                <div>
                  <div className="t">{m.subject}</div>
                  <div className="s">To {m.to} / {new Date(m.at).toLocaleString()}</div>
                </div>
                <button className="btn ghost small" onClick={() => setShowMail(m)}>Read</button>
              </div>
            ))}
          </div>
        </section>
      )}
      </>
      )}

      {showMail && (
        <Modal title={showMail.subject} onClose={() => setShowMail(null)} wide
          footer={<button className="btn ghost" onClick={() => setShowMail(null)}>Close</button>}>
          <div className="meta">To {showMail.to}</div>
          <pre>{showMail.body}</pre>
        </Modal>
      )}

      {isSuper && <AdminTabs tab={tab} setTab={setTab} orgName={org.name} foot />}

      {modal?.kind === 'invite' && (
        <AddPerson ctx={ctx} onClose={() => setModal(null)} toast={toast}
          onDone={() => { setModal(null); loadMembers(); }} />
      )}
      {modal?.kind === 'password' && (
        <SetPassword member={modal.m} onClose={() => setModal(null)} toast={toast} />
      )}
      {modal?.kind === 'purpose' && (
        <PurposeForm org={org} onClose={() => setModal(null)} toast={toast}
          onDone={async () => { setModal(null); await refreshOrgs(); reload(); }} />
      )}
      {modal?.kind === 'value' && (
        <ValueForm value={modal.v} onClose={() => setModal(null)} toast={toast}
          onSave={async (fields) => {
            if (modal.v) await updateValue(modal.v.id, fields);
            else await createValue(org.id, fields);
            toast(modal.v ? 'Value updated.' : 'Value added.');
            setModal(null); reload();
          }} />
      )}
      {modal?.kind === 'measure' && (
        <MeasureForm measure={modal.m} onClose={() => setModal(null)} toast={toast}
          onSave={async (fields) => {
            if (modal.m) await updateMeasure(modal.m.id, fields);
            else await createMeasure(org.id, fields);
            toast(modal.m ? 'Measure updated.' : 'Measure added.');
            setModal(null); loadMeasures();
          }} />
      )}
      {modal?.kind === 'system' && (
        <SystemForm category={modal.s} onClose={() => setModal(null)} toast={toast}
          onSave={async (fields) => {
            await updateSystemCategory(modal.s.id, fields);
            toast('Category renamed.'); setModal(null); reload();
          }} />
      )}
      {modal?.kind === 'org' && (
        <NewOrganization onClose={() => setModal(null)} toast={toast}
          onDone={async () => { setModal(null); await refreshOrgs(); listAllOrganizations().then(setAllOrgs); }} />
      )}
    </>
  );
}

/** The same switch at the head and the foot, so a long page does not send you back up. */
function AdminTabs({ tab, setTab, orgName, foot }) {
  return (
    <div className={foot ? 'tabs foot' : 'tabs'}>
      <button className="tab" aria-pressed={tab === 'super'}
        onClick={() => { setTab('super'); window.scrollTo(0, 0); }}>Super admin</button>
      <button className="tab" aria-pressed={tab === 'org'}
        onClick={() => { setTab('org'); window.scrollTo(0, 0); }}>{orgName}</button>
    </div>
  );
}

/**
 * Everything that is the super user's job, in one place: what this
 * organization is charged, whether it has paid, and the other organizations.
 */
function SuperAdmin({ ctx, billing, billingEvents, allOrgs, reloadBilling, toast }) {
  const { org, refreshOrgs, switchOrg, chooseOrg } = ctx;
  const [newOrg, setNewOrg] = useState(false);

  const save = async (fields, message) => {
    try { await setBillingRates(org.id, fields); toast(message); await refreshOrgs(); reloadBilling(); }
    catch (e) { toast(e.message); }
  };

  if (!billing) return <div className="empty">Billing is not available for this organization.</div>;

  return (
    <>
      <section>
        <div className="sectionhead">
          <h2>{org.name}</h2>
          <span className="note">
            <button className="btn ghost small" onClick={chooseOrg}>Switch organization</button>
          </span>
        </div>

        <div className="rowlist">
          <div className="row">
            <div>
              <div className="t">Plan chosen by this organization</div>
              <div className="s">
                {PLAN_LABEL[billing.plan] ?? billing.plan}
                {billing.cycle ? `, billed ${billing.cycle}` : ', no cycle chosen'}
                {billing.pending_change ? ` / chosen by ${billing.pending_change.by}` : ''}
              </div>
            </div>
            <div className="rowactions">
              {billing.expiring
                ? <Tag type="warn">Cancelled, runs to {billing.paid_through}</Tag>
                : billing.current ? <Tag type="category">Paid, current</Tag>
                  : billing.plan === 'free' ? <Tag type="plain">Free tier</Tag>
                    : <Tag type="warn">Awaiting payment</Tag>}
            </div>
          </div>

          <div className="row">
            <div>
              <div className="t">Set the plan yourself</div>
              <div className="s">Use this when you are arranging the plan for them, or correcting one.</div>
            </div>
            <div className="rowactions">
              <select className="field inline" value={billing.plan}
                onChange={async (e) => {
                  try {
                    await setBillingStatus(org.id, { plan: e.target.value });
                    toast('Plan set.'); await refreshOrgs(); reloadBilling();
                  } catch (err) { toast(err.message); }
                }}>
                <option value="free">Champion only, free</option>
                <option value="small">Up to 9 people</option>
                <option value="unlimited">Unlimited people</option>
              </select>
              <select className="field inline" value={billing.cycle ?? ''}
                onChange={async (e) => {
                  try {
                    await setBillingStatus(org.id, { billing_cycle: e.target.value || null });
                    toast('Billing cycle set.'); await refreshOrgs(); reloadBilling();
                  } catch (err) { toast(err.message); }
                }}>
                <option value="">No cycle</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <div className="t">Paid through</div>
              <div className="s">{billing.paid_through ?? 'Nothing recorded yet'}</div>
            </div>
            <div className="rowactions">
              <Tag type={billing.seats_allowed && billing.seats_used > billing.seats_allowed ? 'warn' : 'plain'}>
                Seats ({billing.seats_used}{billing.seats_allowed ? ` of ${billing.seats_allowed}` : ', unlimited'})
              </Tag>
            </div>
          </div>
        </div>

        {billing.pending_change && (
          <div className="notice flagnotice">
            Waiting on you: {PLAN_LABEL[billing.pending_change.plan]}, billed{' '}
            {billing.pending_change.cycle}, chosen by {billing.pending_change.by} on{' '}
            {new Date(billing.pending_change.at).toLocaleDateString()}. Recording a paid-through
            date below activates it for everyone except the champion, who already has access.
          </div>
        )}
      </section>

      <section>
        <div className="sectionhead"><h2>Rates and payment</h2><span className="note">Super user only</span></div>
        <div className="settinggrid">
          <div className="panel">
            <h4 className="paneltitle">Up to 9 people</h4>
            <div className="tworow">
              <div>
                <label className="fl">Monthly</label>
                <input type="text" defaultValue={billing.rates.small.monthly}
                  onBlur={(e) => save({ rate_small_monthly: Number(e.target.value) }, 'Rate saved.')} />
              </div>
              <div>
                <label className="fl">Yearly</label>
                <input type="text" defaultValue={billing.rates.small.yearly}
                  onBlur={(e) => save({ rate_small_yearly: Number(e.target.value) }, 'Rate saved.')} />
              </div>
            </div>
          </div>
          <div className="panel">
            <h4 className="paneltitle">Unlimited people</h4>
            <div className="tworow">
              <div>
                <label className="fl">Monthly</label>
                <input type="text" defaultValue={billing.rates.unlimited.monthly}
                  onBlur={(e) => save({ rate_unlimited_monthly: Number(e.target.value) }, 'Rate saved.')} />
              </div>
              <div>
                <label className="fl">Yearly</label>
                <input type="text" defaultValue={billing.rates.unlimited.yearly}
                  onBlur={(e) => save({ rate_unlimited_yearly: Number(e.target.value) }, 'Rate saved.')} />
              </div>
            </div>
          </div>
          <div className="panel">
            <h4 className="paneltitle">Record a payment</h4>
            <label className="fl">Paid through</label>
            <input type="date" defaultValue={billing.paid_through ?? ''}
              onChange={async (e) => {
                try {
                  await setBillingStatus(org.id, { paid_through: e.target.value });
                  toast('Payment recorded. Everyone in the plan has access.');
                  await refreshOrgs(); reloadBilling();
                } catch (err) { toast(err.message); }
              }} />
            <p className="meta">
              Current is worked out from this date, and recording one clears any pending change.
              The plan itself is set above.
            </p>
          </div>
        </div>

        {billingEvents.length > 0 && (
          <div className="rowlist" style={{ marginTop: 14 }}>
            {billingEvents.map((e) => (
              <div key={e.id} className="row">
                <div>
                  <div className="t">{EVENT_LABEL[e.kind] ?? e.kind}</div>
                  <div className="s">
                    {new Date(e.at).toLocaleDateString()}
                    {e.detail?.plan ? ` / ${PLAN_LABEL[e.detail.plan] ?? e.detail.plan}` : ''}
                    {e.detail?.cycle ? `, ${e.detail.cycle}` : ''}
                    {e.detail?.by ? ` / ${e.detail.by}` : ''}
                    {e.detail?.paid_through ? ` / paid through ${e.detail.paid_through}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="sectionhead">
          <h2>All organizations</h2>
          <span className="note"><button className="btn small" onClick={() => setNewOrg(true)}>New organization</button></span>
        </div>
        <div className="rowlist">
          {allOrgs.map((o) => {
            const lapsed = o.plan !== 'free' && o.paid_through && new Date(o.paid_through) < new Date();
            return (
              <div key={o.id} className="row">
                <div>
                  <div className="t">{o.name}</div>
                  <div className="s">
                    {o.subtitle}
                    {o.members !== undefined ? ` / ${o.members} people, ${o.behaviors} behaviors` : ''}
                  </div>
                  <div className="tagrow">
                    <Tag type="plain">{PLAN_LABEL[o.plan] ?? o.plan}{o.billing_cycle ? `, ${o.billing_cycle}` : ''}</Tag>
                    {o.paid_through && <Tag type={lapsed ? 'warn' : 'category'}>Paid through {o.paid_through}</Tag>}
                    {o.pending_change && <Tag type="warn">Plan change pending payment</Tag>}
                    {o.cancel_at_period_end && <Tag type="warn">Cancelled</Tag>}
                    {o.has_example_content && <Tag type="plain">Example content</Tag>}
                  </div>
                </div>
                <div className="rowactions">
                  <button className="btn ghost small" disabled={o.id === org.id} onClick={() => switchOrg(o.id)}>
                    {o.id === org.id ? 'Open' : 'Switch to'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {newOrg && (
        <NewOrganization onClose={() => setNewOrg(false)} toast={toast}
          onDone={async () => { setNewOrg(false); await refreshOrgs(); reloadBilling(); }} />
      )}
    </>
  );
}

const EVENT_LABEL = {
  'plan-selected': 'Plan chosen by the organization',
  'payment-recorded': 'Payment recorded',
  cancelled: 'Cancellation requested',
  resumed: 'Resume requested'
};

const PLAN_LABEL = {
  free: 'Champion only, free tier',
  small: 'Up to 9 people',
  unlimited: 'Unlimited people'
};

/** Days since the behavior of the week was last changed, when that is over a week. */
function staleWeek(org) {
  if (!org.weekly_set_at) return null;
  const days = Math.floor((Date.now() - new Date(org.weekly_set_at)) / 86400000);
  return days > 7 ? days : null;
}

/**
 * Both cycle buttons are outlined until one is chosen. The chosen one fills,
 * so the selected plan and cycle are visible without reading the label.
 */
function PlanCard({ name, monthly, yearly, active, cycle, current, onChoose }) {
  const chosen = (c) => active && current && cycle === c;
  return (
    <div className={active && current ? 'plancard active' : 'plancard'}>
      <h4>{name}</h4>
      <div className="planprices">
        <div><span className="pp">{money(monthly)}</span><span className="pl">per month</span></div>
        <div><span className="pp">{money(yearly)}</span><span className="pl">per year</span></div>
      </div>
      <div className="btnrow">
        <button className={chosen('monthly') ? 'btn small chosen' : 'btn ghost small'}
          onClick={() => onChoose('monthly')}>
          {chosen('monthly') ? 'Paying monthly' : 'Pay monthly'}
        </button>
        <button className={chosen('yearly') ? 'btn small chosen' : 'btn ghost small'}
          onClick={() => onChoose('yearly')}>
          {chosen('yearly') ? 'Paying yearly' : 'Pay yearly'}
        </button>
      </div>
    </div>
  );
}

function AccentPicker({ org, toast, refreshOrgs }) {
  const [hex, setHex] = useState(org.accent ?? '#9C7A3C');

  async function apply(value) {
    const v = value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return toast('Use a six digit hex value, like #9C7A3C.');
    try { await updateOrganization(org.id, { accent: v }); await refreshOrgs(); }
    catch (e) { toast(e.message); }
  }

  return (
    <div className="colorrow">
      <input id="accent" type="color" value={hex}
        onChange={(e) => { setHex(e.target.value); apply(e.target.value); }} />
      <input type="text" value={hex} spellCheck={false}
        onChange={(e) => setHex(e.target.value)}
        onBlur={(e) => apply(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply(e.target.value)} />
      <button className="btn ghost small" onClick={() => apply(hex)}>Apply</button>
    </div>
  );
}

function MeasureForm({ measure, onSave, onClose, toast }) {
  const [f, setF] = useState({ name: measure?.name ?? '', note: measure?.note ?? '' });
  return (
    <Modal title={measure ? `Edit ${measure.name}` : 'Add a measure'} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => {
          if (!f.name.trim()) return toast('Name the measure first.');
          onSave({ name: f.name.trim(), note: f.note.trim() });
        }}>Save measure</button>
      </>}>
      <label className="fl">Measure</label>
      <input type="text" placeholder="Commitments closed on time" value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">Note, optional</label>
      <input type="text" placeholder="How it is counted, or where it comes from" value={f.note}
        onChange={(e) => setF({ ...f, note: e.target.value })} />
      <p className="meta" style={{ marginTop: 8 }}>
        Something the organization already tracks. Values are recorded per period from Conviction.
      </p>
    </Modal>
  );
}

function SystemForm({ category, onSave, onClose, toast }) {
  const [name, setName] = useState(category?.name ?? '');
  return (
    <Modal title="Rename system category" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => {
          if (!name.trim()) return toast('Give it a name.');
          onSave({ name: name.trim() });
        }}>Save</button>
      </>}>
      <label className="fl">Name</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <p className="meta" style={{ marginTop: 8 }}>
        Renaming keeps every behavior already applied to it.
      </p>
    </Modal>
  );
}

function PurposeForm({ org, onClose, onDone, toast }) {
  const [f, setF] = useState({
    name: org.name, subtitle: org.subtitle ?? '', initials: org.initials ?? '',
    accent: org.accent ?? '#9C7A3C', mission: org.mission ?? '', vision: org.vision ?? '', creed: org.creed ?? ''
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return toast('The organization needs a name.');
    setBusy(true);
    try { await updateOrganization(org.id, f); toast('Purpose updated.'); onDone(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Purpose and identity" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <label className="fl">Name</label>
      <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">Subtitle</label>
      <input type="text" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
      <div className="tworow">
        <div>
          <label className="fl">Initials</label>
          <input type="text" maxLength={3} value={f.initials}
            onChange={(e) => setF({ ...f, initials: e.target.value.toUpperCase() })} />
        </div>
        <div>
          <label className="fl">Accent color</label>
          <input type="text" value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value })} />
        </div>
      </div>
      <label className="fl">Shared purpose/mission</label>
      <textarea rows={3} value={f.mission} onChange={(e) => setF({ ...f, mission: e.target.value })} />
      <label className="fl">Vision/Where we are going</label>
      <textarea rows={3} value={f.vision} onChange={(e) => setF({ ...f, vision: e.target.value })} />
      <label className="fl">Creed, the line on the culture home</label>
      <textarea rows={3} value={f.creed} onChange={(e) => setF({ ...f, creed: e.target.value })} />
    </Modal>
  );
}

function ValueForm({ value, onSave, onClose, toast }) {
  const [f, setF] = useState({ name: value?.name ?? '', description: value?.description ?? '' });
  return (
    <Modal title={value ? `Edit ${value.name}` : 'Add a value'} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => {
          if (!f.name.trim()) return toast('Name the value first.');
          onSave({ name: f.name.trim(), description: f.description.trim() });
        }}>Save value</button>
      </>}>
      <label className="fl">Name</label>
      <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">What it means here</label>
      <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <p className="meta" style={{ marginTop: 8 }}>
        Attach it to behaviors from each behavior's edit form. A value with no behavior under it is a poster.
      </p>
    </Modal>
  );
}

function AddPerson({ ctx, onClose, onDone, toast }) {
  const [f, setF] = useState({ email: '', name: '', role: 'member', password: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await createUser(ctx.org.id, f);
      toast(`${f.name || f.email} added as ${f.role}.`);
      onDone();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Add a person" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button>
      </>}>
      <p className="quiet">They join {ctx.org.name} and see only this organization's data.</p>
      <label className="fl">Email</label>
      <input type="text" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label className="fl">Name</label>
      <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">Role</label>
      <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <p className="meta" style={{ marginTop: 6 }}>{ROLES.find((r) => r.id === f.role)?.can}</p>
      <label className="fl">Starting password</label>
      <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
        placeholder="At least eight characters" />
      <p className="meta" style={{ marginTop: 6 }}>Send it to them yourself and have them change it after the first sign-in.</p>
    </Modal>
  );
}

function SetPassword({ member, onClose, toast }) {
  const [pw, setPw] = useState('');
  return (
    <Modal title={`Reset password for ${member.display_name}`} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={async () => {
          try { await resetUserPassword(member.user_id, pw); toast('Password reset.'); onClose(); }
          catch (e) { toast(e.message); }
        }}>Set password</button>
      </>}>
      <label className="fl">New password</label>
      <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least eight characters" />
    </Modal>
  );
}

function NewOrganization({ onClose, onDone, toast }) {
  const [f, setF] = useState({ name: '', subtitle: '', initials: '', accent: '#9C7A3C', mission: '', vision: '', creed: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return toast('Name the organization first.');
    setBusy(true);
    try { await createOrganization(f); toast(`${f.name} created. Add its champion next.`); onDone(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="New organization" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
      </>}>
      <p className="quiet">It starts empty. Add a culture champion, then build the behaviors with them.</p>
      <label className="fl">Name</label>
      <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">Subtitle</label>
      <input type="text" placeholder="Where they are, or which team" value={f.subtitle}
        onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
      <label className="fl">Initials</label>
      <input type="text" maxLength={3} value={f.initials} onChange={(e) => setF({ ...f, initials: e.target.value.toUpperCase() })} />
      <label className="fl">Accent color</label>
      <input type="text" value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value })} />
      <label className="fl">Shared purpose/mission</label>
      <textarea rows={2} value={f.mission} onChange={(e) => setF({ ...f, mission: e.target.value })} />
      <label className="fl">Vision/Where they are going</label>
      <textarea rows={2} value={f.vision} onChange={(e) => setF({ ...f, vision: e.target.value })} />
    </Modal>
  );
}
