import React, { useEffect, useState } from 'react';
import {
  signIn, createPortal, requestAccess, requestPasswordReset, resetPassword,
  listOrganizationNames, IS_LOCAL
} from '../lib/api.js';

/**
 * Four ways to arrive: sign in, start a new portal, ask to join one, or
 * recover a password. Everything else in the app assumes a signed-in person,
 * so all of it lives here.
 */
export default function SignIn() {
  const [mode, setMode] = useState('signin');

  return (
    <div className="signin">
      <h1 className="pagetitle">Culture Portal</h1>

      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className="tab" aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
        <button className="tab" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create a new culture portal</button>
        <button className="tab" aria-pressed={mode === 'request'} onClick={() => setMode('request')}>Request access</button>
        <button className="tab" aria-pressed={mode === 'forgot'} onClick={() => setMode('forgot')}>Forgot password</button>
      </div>

      {mode === 'signin' && <SignInForm onForgot={() => setMode('forgot')} />}
      {mode === 'create' && <CreatePortal />}
      {mode === 'request' && <RequestAccess onDone={() => setMode('signin')} />}
      {mode === 'forgot' && <ForgotPassword onDone={() => setMode('signin')} />}
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
      <p className="lede">Sign in with the account your organization set up for you.</p>
      <div className="panel" style={{ maxWidth: 420 }}>
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
      <p className="meta" style={{ maxWidth: 420, marginTop: 16 }}>
        Your organization and your role are assigned by your administrator.
      </p>
    </>
  );
}

function CreatePortal() {
  const [f, setF] = useState({ orgName: '', subtitle: '', championName: '', championEmail: '', password: '' });
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
      <p className="lede">
        Set up a portal for your organization. You become its culture champion, which is the
        one seat that is always free.
      </p>
      <div className="panel" style={{ maxWidth: 480 }}>
        <Field label="Organization name" value={f.orgName} onChange={set('orgName')} />
        <Field label="Subtitle, optional" hint="Where you are, or which team." value={f.subtitle} onChange={set('subtitle')} />
        <Field label="Your name" value={f.championName} onChange={set('championName')} />
        <Field label="Your email" autoComplete="username" value={f.championEmail} onChange={set('championEmail')} />
        <label className="fl">Choose a password</label>
        <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        <p className="meta">At least eight characters.</p>
        <div className="btnrow">
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? 'Setting it up…' : 'Create the portal'}
          </button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      <p className="meta" style={{ maxWidth: 480, marginTop: 16 }}>
        It starts with three example behaviors, three example values and a practice session, all
        marked as examples until you edit them or clear them out. You can add people once you
        pick a plan.
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
      <p className="lede">Ask to join an organization already using the portal.</p>
      <div className="panel" style={{ maxWidth: 480 }}>
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
      <p className="lede">Set a new password for your account.</p>
      <div className="panel" style={{ maxWidth: 440 }}>
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
