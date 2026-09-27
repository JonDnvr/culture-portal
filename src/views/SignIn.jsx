import React, { useEffect, useState } from 'react';
import stone from '../assets/horizon-stone.webp';
import hlgLogo from '../assets/hlg-logo.webp';
import { TRIAL_DAYS, DEFAULT_RATES, money } from '../lib/billing.js';
import {
  signIn, signOut, createPortal, requestAccess, requestPasswordReset, resetPassword,
  listOrganizationNames, IS_LOCAL, getPlatformPricing
} from '../lib/api.js';

/**
 * The front door, in Horizon Line Group's own look since nobody has picked an
 * organization yet. Written for a prospect first (what this is, why it works,
 * start a trial) and for members second (sign in).
 *
 * It can sit in an iframe on horizonlinegroup.com. Framed, the buttons open
 * the portal at full size instead of signing in inside the frame, because
 * Stripe and the portal itself need the whole window.
 */
const FRAMED = (() => { try { return window.self !== window.top; } catch { return true; } })();
const startMode = () => {
  const m = new URLSearchParams(window.location.search).get('mode');
  return ['signin', 'create', 'request', 'forgot'].includes(m) ? m : 'signin';
};
const fullUrl = (mode) => `${window.location.origin}${window.location.pathname}?mode=${mode}`;

export default function SignIn() {
  const [mode, setMode] = useState(startMode);
  const go = (m) => {
    setMode(m);
    document.querySelector('.hlg-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={FRAMED ? 'hlg framed' : 'hlg'}>
      <header className="hlg-bar">
        <a className="hlg-mark" href="https://horizonlinegroup.com" target="_top" rel="noopener">
          <img className="hlg-logo" src={hlgLogo} alt="" />
          <span>Horizon Line Group</span>
        </a>
        <span className="hlg-product">
          Culture Portal
          {FRAMED
            ? <a className="btn small" href={fullUrl('signin')} target="_top">Sign in</a>
            : <button className="btn small" onClick={() => go('signin')}>Sign in</button>}
        </span>
      </header>

      <div className="hlg-grid">
        <section className="hlg-pitch" aria-labelledby="hlg-h1">
          <div className="hlg-hero" style={{ backgroundImage: `url(${stone})` }} role="img"
            aria-label="A stone with a single white line across it, the sea behind." />
          <h1 id="hlg-h1" className="hlg-h1">Your culture, practiced regularly.</h1>
          <p className="hlg-lede">
            Most culture lives on a wall. The Culture Portal turns your values into defined behaviors
            people can name, practice together, and recognize in each other, with a clear read on
            whether it is holding.
          </p>

          <div className="hlg-trial">
            <div>
              <h2>Try it free for 30 days</h2>
              <p>
                No card to start. Set up your organization in two minutes with example behaviors to
                edit, invite your team, and add a payment method only if you keep it.
              </p>
            </div>
            {FRAMED
              ? <a className="btn hlg-gold" href={fullUrl('create')} target="_top">Start your free trial</a>
              : <button className="btn hlg-gold" onClick={() => go('create')}>Start your free trial</button>}
          </div>

          <h2 className="hlg-youget">You get</h2>
          <ul className="hlg-four">
            <li><strong>Clarity</strong> Translate values to clear behaviors with tips and questions
              to bring them to life.</li>
            <li><strong>Cadence</strong> Behavior of the week, rituals, systems and templates, to
              make practice routine.</li>
            <li><strong>Connection</strong> Recognize someone in seconds. Add Stories to make the
              good visible. Fluency tracking, and awards keep people engaged.</li>
            <li><strong>Conviction</strong> Ratings, measures, coverage gaps and team streaks show
              where culture is strong and where it is thin.</li>
            <li><strong>Engagement</strong> Email with practice prompts, and printable handouts bring
              culture outside the portal.</li>
          </ul>

          <p className="hlg-members">
            <strong>Already part of a portal?</strong> Sign in with the account set up for you or
            request access from your company. A couple of minutes a week is enough.
          </p>
        </section>

        <section className="hlg-panel" aria-label="Sign in or start a portal">
          {FRAMED ? (
            <div className="panel hlg-framed">
              <h2 className="hlg-panelh">Open the portal</h2>
              <p className="meta">It opens full size, so you can work in it comfortably.</p>
              <div className="btnrow">
                <a className="btn" href={fullUrl('signin')} target="_top">Sign in</a>
                <a className="btn ghost" href={fullUrl('create')} target="_top">Start a free trial</a>
                <a className="btn ghost" href={fullUrl('request')} target="_top">Request access</a>
              </div>
            </div>
          ) : (
            <>
              <div className="tabs hlg-tabs">
                <button className="tab" aria-pressed={mode === 'signin' || mode === 'forgot'} onClick={() => setMode('signin')}>Sign in</button>
                <button className="tab" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Start a free trial</button>
                <button className="tab" aria-pressed={mode === 'request'} onClick={() => setMode('request')}>Request access</button>
              </div>

              {mode === 'signin' && <SignInForm onForgot={() => setMode('forgot')} />}
              {mode === 'create' && <CreatePortal />}
              {mode === 'request' && <RequestAccess onDone={() => setMode('signin')} />}
              {mode === 'forgot' && <ForgotPassword onDone={() => setMode('signin')} />}
            </>
          )}
        </section>
      </div>

      <footer className="hlg-foot">
        Built to drive high performing culture: name the behaviors, practice them with rhythm, and
        integrate them into how you already run.{' '}
        <a href="https://horizonlinegroup.com" target="_top" rel="noopener">horizonlinegroup.com</a>
      </footer>
    </div>
  );
}

function Field({ label, hint, ...rest }) {
  return (
    <>
      <label className="fl">{label}</label>
      <input type="text" {...rest} />
      {hint && <p className="meta">{hint}</p>}
    </>
  );
}

function SignInForm({ onForgot }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try { await signIn(email, password); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  const onEnter = (e) => e.key === 'Enter' && submit();

  return (
    <>
      <div className="panel">
        <Field label="Email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
        <label className="fl">Password</label>
        <input type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
        <div className="btnrow">
          <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button className="btn ghost" onClick={onForgot}>Forgot password</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      <p className="meta" style={{ marginTop: 12 }}>
        Your organization and your role are assigned by your culture champion or administrator.
      </p>
    </>
  );
}

function CreatePortal() {
  const [f, setF] = useState({ orgName: '', subtitle: '', championName: '', championEmail: '', password: '' });
  const [rates, setRates] = useState(DEFAULT_RATES);
  useEffect(() => { getPlatformPricing().then((r) => r && setRates(r)).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setBusy(true); setErr(null);
    try { await createPortal(f); }   // signs the champion straight in
    catch (e) { setErr(e.message); setBusy(false); }
  }


  return (
    <>
      <div className="panel">
        <h2 className="hlg-panelh">Start your {TRIAL_DAYS}-day free trial</h2>
        <p className="meta" style={{ marginTop: 0 }}>
          You become the culture champion: you run the portal for your organization and keep access
          whatever happens to the plan.
        </p>

        <div className="pricebox">
          <div><strong>Up to 9 people</strong><span>{money(rates.small.monthly)} a month or {money(rates.small.yearly)} a year</span></div>
          <div><strong>Unlimited people</strong><span>{money(rates.unlimited.monthly)} a month or {money(rates.unlimited.yearly)} a year</span></div>
        </div>
        <p className="meta">
          Both plans include everything, pick a plan and set up payment only if you keep it. The
          trial gives you unlimited people for {TRIAL_DAYS} days, with no card.
        </p>

        <Field label="Organization name" value={f.orgName} onChange={set('orgName')} />
        <Field label="Your name" hint="Who's the Culture Champion." value={f.championName} onChange={set('championName')} />
        <Field label="Your email" autoComplete="username" value={f.championEmail} onChange={set('championEmail')} />
        <label className="fl">Choose a password</label>
        <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        <p className="meta">At least eight characters.</p>
        <div className="btnrow">
          <button className="btn hlg-gold" onClick={submit} disabled={busy}>
            {busy ? 'Setting it up…' : 'Start the free trial'}
          </button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      <p className="meta" style={{ marginTop: 12 }}>
        It starts with three example values, three example behaviors and a practice session, all
        marked as examples until you edit them or clear them out.
      </p>
    </>
  );
}

function RequestAccess({ onDone }) {
  const [f, setF] = useState({ name: '', email: '', orgName: '', password: '', note: '' });
  const [orgs, setOrgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { listOrganizationNames().then(setOrgs).catch(() => setOrgs([])); }, []);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await requestAccess(f);
      setSent(res?.org ?? f.orgName);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <>
        <p className="lede">Your request has gone to {sent}.</p>
        <div className="panel" style={{ maxWidth: 480 }}>
          <p>
            An admin there sees it as a tentative member and turns it on. You will get a welcome
            email when they do, and the password you just chose will work.
          </p>
          <div className="btnrow"><button className="btn ghost" onClick={onDone}>Back to sign in</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="panel">
        <p className="meta" style={{ marginTop: 0 }}>Ask to join an organization already using the portal.</p>
        <Field label="Your name" value={f.name} onChange={set('name')} />
        <Field label="Your email" autoComplete="username" value={f.email} onChange={set('email')} />
        <label className="fl">Organization</label>
        {orgs.length ? (
          <select className="field" value={f.orgName} onChange={set('orgName')}>
            <option value="">Choose one</option>
            {orgs.map((o) => <option key={o.id ?? o.name} value={o.name}>{o.name}</option>)}
          </select>
        ) : (
          <input type="text" value={f.orgName} onChange={set('orgName')}
            placeholder="Type the name as your champion gave it to you" />
        )}
        <label className="fl">Choose a password</label>
        <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        <p className="meta">It starts working once an admin approves you.</p>
        <Field label="Anything they should know, optional" value={f.note} onChange={set('note')} />
        <div className="btnrow">
          <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Request access'}</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
    </>
  );
}

function ForgotPassword({ onDone }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true); setErr(null);
    try {
      const res = await requestPasswordReset(email);
      // Local mode has no mail server, so it hands back the code directly.
      if (res?.code) setHint(res.code);
      setStep(res?.hosted ? 'hosted' : 'code');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (password !== confirm) return setErr('Those two passwords do not match.');
    setBusy(true); setErr(null);
    try { await resetPassword({ email, code, password }); setStep('done'); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="panel">
        <h2 className="hlg-panelh">Forgot password</h2>
        <p className="meta" style={{ marginTop: 0 }}>Set a new password for your account.</p>
        {step === 'email' && (
          <>
            <Field label="Your email" value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()} />
            <p className="meta">
              We send a six digit code. It works once and expires in thirty minutes. If the address
              has no account, nothing is sent, and this page says the same thing either way.
            </p>
            <div className="btnrow">
              <button className="btn" onClick={ask} disabled={busy}>{busy ? 'Sending…' : 'Send the code'}</button>
              <button className="btn ghost" onClick={onDone}>Back to sign in</button>
            </div>
          </>
        )}

        {step === 'hosted' && (
          <>
            <p>Check your inbox. The link signs you in and lets you set a new password.</p>
            <div className="btnrow"><button className="btn ghost" onClick={onDone}>Back to sign in</button></div>
          </>
        )}

        {step === 'code' && (
          <>
            {hint && IS_LOCAL && (
              <div className="notice">
                Local mode has no mail server, so here is the code: <strong>{hint}</strong>.
                In hosted mode it arrives by email.
              </div>
            )}
            <Field label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <label className="fl">New password</label>
            <input type="password" autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
            <label className="fl">Type it again</label>
            <input type="password" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && finish()} />
            <div className="btnrow">
              <button className="btn" onClick={finish} disabled={busy}>{busy ? 'Saving…' : 'Set the password'}</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p>Done. Sign in with the new password.</p>
            <div className="btnrow"><button className="btn" onClick={onDone}>Back to sign in</button></div>
          </>
        )}

        {err && <p className="err">{err}</p>}
      </div>
    </>
  );
}


/**
 * Where a password reset email lands. The link has already signed the person
 * in, so this only has to take the new password. Until they set one, the
 * portal stays out of reach.
 */
export function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (password.length < 8) return setErr('Use at least eight characters.');
    if (password !== confirm) return setErr('Those two passwords do not match.');
    setBusy(true); setErr(null);
    try { await resetPassword({ password }); onDone(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="signin">
      <h1 className="pagetitle">Choose a new password</h1>
      <p className="lede">You followed a reset link. Set your new password to continue.</p>
      <div className="panel" style={{ maxWidth: 420 }}>
        <label className="fl">New password</label>
        <input type="password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <label className="fl">Type it again</label>
        <input type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div className="btnrow">
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Set the password'}</button>
          <button className="btn ghost" onClick={() => signOut()}>Cancel</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      <p className="meta" style={{ maxWidth: 420, marginTop: 16 }}>
        If this page says the link has expired, go back to Forgot password and ask for a new one.
        Links work once and last about an hour.
      </p>
    </div>
  );
}
