import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  getSession, onAuthChange, signOut,
  listMyOrganizations, listValues, listSystemCategories,
  listBehaviors, listRituals, listCategories,
  listPeople, listTeams, listAwardTypes, listAwardGrants,
  listIterations, listRecognitions, listStories, listMyFluencyMarks,
  getPulseStatus, getPulseSpreadByRound,
  IS_LOCAL, resetLocalData, ARRIVED_FROM_RESET, onPasswordRecovery
} from './lib/api.js';
import TrophyWall from './views/TrophyWall.jsx';
import ProfileDialog from './views/Profile.jsx';
import { Avatar, ConfirmHost, confirmAction } from './components/ui.jsx';
import { DraftsDialog, draftCount } from './views/RecordEditor.jsx';
import { NavIcon } from './components/badges.jsx';
import { termFor } from './lib/term.js';
import Home from './views/Home.jsx';
import Clarity from './views/Clarity.jsx';
import Behavior from './views/Behavior.jsx';
import Cadence from './views/Cadence.jsx';
import Connection from './views/Connection.jsx';
import Conviction from './views/Conviction.jsx';
import Admin from './views/Admin.jsx';
import { StoryPage, RecognitionPage, IterationPage, RitualPage } from './views/Details.jsx';
import PulseCheck from './views/PulseCheck.jsx';
import SignIn, { SetNewPassword } from './views/SignIn.jsx';

const ALL_ROLES = ['member', 'leader', 'admin', 'champion', 'owner'];
const EDITORS = ['admin', 'champion', 'owner'];

// The working sections: the rail on a wide screen, a bar along the bottom
// on a phone. `short` is the phone label.
const NAV = [
  { id: 'home', label: 'Culture home', short: 'Home', sub: 'This week', roles: ALL_ROLES },
  { id: 'clarity', label: 'Clarity', short: 'Clarity', sub: (t) => `The ${t.many}`, roles: ALL_ROLES },
  { id: 'cadence', label: 'Cadence', short: 'Cadence', sub: 'Practice', roles: ALL_ROLES },
  { id: 'connection', label: 'Connection', short: 'Connect', sub: 'Recognition, stories', roles: ALL_ROLES },
  { id: 'conviction', label: 'Conviction', short: 'Conviction', sub: 'Is it holding?', roles: ['leader', ...EDITORS] }
];

// In the header, beside your name: Awards, then Admin.
const FOOT = [
  { id: 'wall', label: 'Awards', roles: ALL_ROLES },
  { id: 'admin', label: 'Admin', roles: EDITORS }
];

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pad">
        <h1 className="pagetitle">Something broke</h1>
        <p className="lede">{String(this.state.error.message || this.state.error)}</p>
        <p className="meta" style={{ maxWidth: '60ch' }}>
          If this followed an update, the copy of the data saved in this browser is from an
          older version. Clearing it rebuilds the seeded organizations and signs you out.
        </p>
        <div className="btnrow">
          <button className="btn" onClick={() => { resetLocalData(); window.location.reload(); }}>
            Clear local data and reload
          </button>
          <button className="btn ghost" onClick={() => window.location.reload()}>Just reload</button>
        </div>
      </div>
    );
  }
}

export default function AppWithBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}

function App() {
  const [session, setSession] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [org, setOrg] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState('home');
  const [behaviorId, setBehaviorId] = useState(null);
  const [detail, setDetail] = useState(null); // { kind, id } for a record's own page
  const [history, setHistory] = useState([]); // where Back should return to
  // Arriving from a password reset email: the link says ?reset=1, and Supabase
  // adds its own marker. Either way the person must choose a password first.
  const [recovering, setRecovering] = useState(() => {
    const url = window.location.search + window.location.hash;
    return ARRIVED_FROM_RESET || /[?&]reset=1/.test(url) || /type=recovery/.test(url);
  });

  // Supabase's own signal, which arrives however the return address was formed.
  useEffect(() => {
    const sub = onPasswordRecovery(() => setRecovering(true));
    return () => sub.unsubscribe();
  }, []);
  const [error, setError] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  // What the browser's Back button should do, read fresh on every press.
  const navRef = useRef(null);
  useBackGuard(!!session && !!org, navRef);
  // Bumped by "Rate now" to bring the pulse back even after it was dismissed.
  const [pulseAsk, setPulseAsk] = useState(0);

  useEffect(() => {
    getSession().then(setSession);
    const { data: sub } = onAuthChange(setSession);
    // Local mode has no auth provider, so sign in and out raise a window event.
    const refresh = () => getSession().then(setSession);
    window.addEventListener('local-auth', refresh);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('local-auth', refresh); };
  }, []);

  useEffect(() => {
    if (!session) { setOrgs([]); setOrg(null); setData(null); return; }
    listMyOrganizations()
      .then((list) => {
        setOrgs(list);
        setOrg((current) => {
          if (current) return list.find((o) => o.id === current.id) ?? null;
          // A super user picks which organization to work in rather than
          // being dropped into whichever sorted first.
          if (list.length > 1 && list[0]?.isSuper) return null;
          return list[0] ?? null;
        });
      })
      .catch((e) => setError(e.message));
  }, [session]);

  const load = useCallback(async () => {
    if (!org) return;
    try {
      // Anything added in R1 falls back to empty rather than failing the page,
      // so the site still loads if it is deployed a moment before the database
      // migration has run.
      const soft = (p, fallback) => p.catch((e) => { console.warn(e); return fallback; });
      const [values, systems, behaviors, rituals, categories,
        people, teams, awardTypes, grants,
        iterations, recognitions, stories, fluencyMarks, pulseStatus, pulseSpread] = await Promise.all([
        listValues(org.id), listSystemCategories(org.id), listBehaviors(org.id),
        listRituals(org.id), listCategories(),
        soft(listPeople(org.id), []), soft(listTeams(org.id), []),
        soft(listAwardTypes(org.id), []), soft(listAwardGrants(org.id, WITH_DRAFTS), []),
        soft(listIterations(org.id, WITH_DRAFTS), []), soft(listRecognitions(org.id, WITH_DRAFTS), []),
        soft(listStories(org.id, WITH_DRAFTS), []),
        soft(listMyFluencyMarks(org.id), []),
        soft(getPulseStatus(org.id), null), soft(getPulseSpreadByRound(org.id), [])
      ]);
      setData({
        values, systems, behaviors, rituals, categories, people, teams, awardTypes,
        grants: published(grants),
        activity: { iterations: published(iterations), recognitions: published(recognitions), stories: published(stories),
          fluencyMarks, pulseStatus, pulseSpread },
        drafts: { iterations: drafts(iterations), recognitions: drafts(recognitions), stories: drafts(stories), grants: drafts(grants) }
      });
    } catch (e) { setError(e.message); }
  }, [org]);

  useEffect(() => { load(); }, [load]);

  /**
   * Just the activity behind the badges and fluency rings, without reloading
   * content. Pages that show rings call it when they open, so a practice read
   * or recorded elsewhere shows up when you come back.
   */
  const refreshActivity = useCallback(async () => {
    if (!org) return;
    const soft = (p, fallback) => p.catch(() => fallback);
    const [iterations, recognitions, stories, fluencyMarks, pulseStatus, pulseSpread, grants] = await Promise.all([
      soft(listIterations(org.id, WITH_DRAFTS), null), soft(listRecognitions(org.id, WITH_DRAFTS), null),
      soft(listStories(org.id, WITH_DRAFTS), null),
      soft(listMyFluencyMarks(org.id), null), soft(getPulseStatus(org.id), null),
      soft(getPulseSpreadByRound(org.id), null), soft(listAwardGrants(org.id, WITH_DRAFTS), null)
    ]);
    // Anything that failed to load keeps what was there before.
    const pick = (rows, split, before) => (rows ? split(rows) : before);
    setData((d) => d && ({
      ...d,
      grants: pick(grants, published, d.grants),
      activity: {
        iterations: pick(iterations, published, d.activity.iterations),
        recognitions: pick(recognitions, published, d.activity.recognitions),
        stories: pick(stories, published, d.activity.stories),
        fluencyMarks: fluencyMarks ?? d.activity.fluencyMarks,
        pulseStatus: pulseStatus ?? d.activity.pulseStatus,
        pulseSpread: pulseSpread ?? d.activity.pulseSpread
      },
      drafts: {
        iterations: pick(iterations, drafts, d.drafts.iterations),
        recognitions: pick(recognitions, drafts, d.drafts.recognitions),
        stories: pick(stories, drafts, d.drafts.stories),
        grants: pick(grants, drafts, d.drafts.grants)
      }
    }));
  }, [org]);

  if (!session) return <SignIn />;
  if (recovering) return (
    <SetNewPassword onDone={() => {
      setRecovering(false);
      // Drop the reset markers so a reload does not ask again.
      window.history.replaceState(null, '', window.location.pathname);
    }} />
  );
  if (error) return (
    <div className="pad">
      <p className="empty">{error}</p>
      <div className="btnrow"><button className="btn ghost" onClick={() => { setError(null); signOut(); }}>Sign out</button></div>
    </div>
  );
  if (!org && orgs.length > 1) return (
    <ChooseOrg orgs={orgs} onPick={(o) => { setOrg(o); setView('admin'); }} />
  );
  if (!org) return (
    <div className="pad">
      <p className="empty">Your account is not attached to an organization yet. Your administrator assigns that.</p>
      <div className="btnrow"><button className="btn ghost" onClick={signOut}>Sign out</button></div>
    </div>
  );
  if (!data) return <div className="pad"><p className="empty">Loading…</p></div>;

  // The role comes from the membership record. Nobody picks their own.
  const role = org.role;
  const isSuper = !!org.isSuper;
  const nav = NAV.filter((n) => n.roles.includes(role));
  const foot = FOOT.filter((n) => n.roles.includes(role));
  const term = termFor(org);
  const userId = session?.user?.id ?? null;
  const me = data.people.find((p) => p.user_id === userId) ?? null;

  const ctx = {
    org, role, isSuper, ...data, reload: load, refreshActivity, term,
    openPulse: () => { setPulseAsk((n) => n + 1); window.scrollTo(0, 0); },
    userId, me, myTeamId: me?.team_id ?? null,
    openBehavior: (id) => {
      setHistory((h) => [...h, { view, behaviorId, detail }]);
      setDetail(null); setBehaviorId(id); setView('behavior'); window.scrollTo(0, 0);
    },
    openRecord: (kind, id) => {
      setHistory((h) => [...h, { view, behaviorId, detail }]);
      setDetail({ kind, id }); setView('record'); window.scrollTo(0, 0);
    },
    goto: (v) => { setHistory([]); setBehaviorId(null); setDetail(null); setView(v); window.scrollTo(0, 0); },
    // Back returns to wherever you came from, however deep the chain went.
    back: () => {
      setHistory((h) => {
        const prev = h[h.length - 1];
        if (!prev) { setView('home'); setBehaviorId(null); setDetail(null); return []; }
        setView(prev.view); setBehaviorId(prev.behaviorId); setDetail(prev.detail);
        window.scrollTo(0, 0);
        return h.slice(0, -1);
      });
    },
    canEdit: EDITORS.includes(role) || isSuper,
    canLead: role !== 'member',
    // Refetch and re-point at the same organization, so an edit to its name,
    // purpose or behavior of the week shows up immediately.
    refreshOrgs: async () => {
      const list = await listMyOrganizations();
      setOrgs(list);
      setOrg((current) => (current ? list.find((o) => o.id === current.id) ?? null : null));
      return list;
    },
    switchOrg: (id) => {
      const next = orgs.find((o) => o.id === id);
      // A super user switching organizations is doing administration, so land
      // them where that work happens.
      if (next) { setOrg(next); setBehaviorId(null); setDetail(null); setHistory([]); setView('admin'); }
    },
    chooseOrg: () => { setOrg(null); setBehaviorId(null); setDetail(null); setHistory([]); }
  };

  navRef.current = { view, depth: history.length, back: ctx.back };
  const count = draftCount(ctx);

  return (
    <div className="shell" style={{ '--accent': org.accent || '#9C7A3C' }}>
      <header className="topbar">
        <button className="brandmark" onClick={() => ctx.goto('home')} title={`${org.name} culture home`}>
          <span className="chip" style={{ background: org.accent }}>{org.initials}</span>
          <span className="orgname">{org.name}</span>
        </button>
        <div className="topnav">
          {foot.map((n) => (
            <button key={n.id} className="topbtn" aria-current={view === n.id ? 'page' : undefined} onClick={() => ctx.goto(n.id)}>
              <span className="navicon" style={{ color: org.accent || 'var(--accent)' }}><NavIcon id={n.id} /></span>
              <span className="tlabel">{n.label}</span>
            </button>
          ))}
          <MeMenu ctx={ctx} me={me} orgs={orgs} draftCount={count}
            onPicture={() => setProfileOpen(true)} onDrafts={() => setDraftsOpen(true)} />
        </div>
      </header>
      <div className="frame">
        <aside className="rail">
          <nav className="mainnav" aria-label="Sections">
            {nav.map((n) => <NavButton key={n.id} n={n} term={term} current={view === n.id} onGo={ctx.goto} accent={org.accent} />)}
          </nav>
        </aside>
        <main>
          {!isSuper && <PulseCheck ctx={ctx} ask={pulseAsk} />}
          <div className="view">
            {view === 'home' && <Home ctx={ctx} />}
            {view === 'clarity' && <Clarity ctx={ctx} />}
            {view === 'behavior' && <Behavior ctx={ctx} id={behaviorId} />}
            {view === 'cadence' && <Cadence ctx={ctx} />}
            {view === 'connection' && <Connection ctx={ctx} />}
            {view === 'conviction' && <Conviction ctx={ctx} />}
            {view === 'admin' && <Admin ctx={ctx} />}
            {view === 'wall' && <TrophyWall ctx={ctx} />}
            {view === 'record' && detail?.kind === 'story' && <StoryPage key={detail.id} ctx={ctx} id={detail.id} />}
            {view === 'record' && detail?.kind === 'recognition' && <RecognitionPage key={detail.id} ctx={ctx} id={detail.id} />}
            {view === 'record' && detail?.kind === 'iteration' && <IterationPage key={detail.id} ctx={ctx} id={detail.id} />}
            {view === 'record' && detail?.kind === 'ritual' && <RitualPage key={detail.id} ctx={ctx} id={detail.id} />}
          </div>
        </main>
      </div>
      {profileOpen && <ProfileDialog ctx={ctx} onClose={() => setProfileOpen(false)} />}
      {draftsOpen && <DraftsDialog ctx={ctx} onClose={() => setDraftsOpen(false)} />}
      <ConfirmHost />
    </div>
  );
}

const WITH_DRAFTS = { includeDrafts: true };
const published = (rows) => (rows ?? []).filter((r) => !r.is_draft);
const drafts = (rows) => (rows ?? []).filter((r) => r.is_draft);

/**
 * You, in the header: your picture, then a short menu. The organization
 * switcher lives here for the super admin.
 */
function MeMenu({ ctx, me, orgs, draftCount, onPicture, onDrafts }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { org, isSuper } = ctx;

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const act = (fn) => () => { setOpen(false); fn(); };
  const first = (org.displayName ?? '').split(' ')[0];

  return (
    <div className="memenu" ref={box}>
      <button className="topbtn mebtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        title="Your picture, drafts and sign out">
        <Avatar person={me} name={org.displayName} size={28} />
        <span className="tlabel">{first}</span>
        {draftCount > 0 && <span className="countchip" aria-label={`${draftCount} drafts`}>{draftCount}</span>}
      </button>
      {open && (
        <div className="menupop" role="menu">
          <div className="menuhead">{org.displayName}</div>
          <button className="mi" role="menuitem" onClick={act(onPicture)}>Change picture</button>
          <button className="mi" role="menuitem" onClick={act(onDrafts)}>
            Your drafts{draftCount ? ` (${draftCount})` : ''}
          </button>
          {isSuper && orgs.length > 1 && (
            <label className="mi misel">
              <span>Organization</span>
              <select value={org.id} onChange={(e) => { setOpen(false); ctx.switchOrg(e.target.value); }}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <button className="mi" role="menuitem" onClick={act(signOut)}>Sign out</button>
          {IS_LOCAL && isSuper && (
            <button className="mi quietmi" role="menuitem" onClick={act(() => { resetLocalData(); signOut(); })}>Reset demo data</button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The browser's Back button moves back through the portal: it closes an open
 * dialog first, then returns to the page before. On the home page, with
 * nowhere left to go inside the portal, it asks before leaving. Closing or
 * reloading the tab with a form open asks too.
 *
 * One extra history entry sits above the page's own; every Back lands on the
 * page's entry, and the guard is put straight back.
 */
function useBackGuard(active, navRef) {
  useEffect(() => {
    if (!active) return undefined;
    const GUARD = { cpGuard: true };
    if (!window.history.state?.cpGuard) window.history.pushState(GUARD, '');
    let leaving = false;

    const onPop = async () => {
      if (leaving) return;
      window.history.pushState(GUARD, '');
      if (document.querySelector('.scrim')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      const nav = navRef.current;
      if (nav && (nav.depth > 0 || nav.view !== 'home')) { nav.back(); return; }
      const ok = await confirmAction({
        title: 'Leave the culture portal?',
        body: 'Going back from here leaves the portal. You stay signed in.',
        action: 'Leave', danger: false
      });
      if (!ok) return;
      leaving = true;
      window.history.go(-2);
      // Nowhere to go back to (the portal was the first page in this tab):
      // stay, and put the guard back.
      setTimeout(() => {
        leaving = false;
        if (!window.history.state?.cpGuard) window.history.pushState(GUARD, '');
      }, 700);
    };

    const onUnload = (e) => {
      if (window.__cpAllowUnload || !document.querySelector('.scrim .modal')) return;
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active]);
}

/** A section in the rail, with its icon in the organization's highlight color. */
function NavButton({ n, term, current, onGo, accent }) {
  return (
    <button className="navitem" aria-current={current ? 'page' : undefined} onClick={() => onGo(n.id)} title={n.label}>
      <span className="navicon" style={{ color: accent || 'var(--accent)' }}><NavIcon id={n.id} /></span>
      <span className="navtext">
        <span className="full">{n.label}</span><span className="short">{n.short}</span>
        {n.sub && <small>{typeof n.sub === 'function' ? n.sub(term) : n.sub}</small>}
      </span>
    </button>
  );
}

/** Where a super user starts: which organization am I working in today? */
function ChooseOrg({ orgs, onPick }) {
  return (
    <div className="signin">
      <h1 className="pagetitle">Choose an organization</h1>
      <p className="lede">You have access to all of them. Pick the one you are working in.</p>
      <div className="orgpicker">
        {orgs.map((o) => (
          <button key={o.id} className="orgcard" onClick={() => onPick(o)}>
            <span className="chip" style={{ background: o.accent }}>{o.initials}</span>
            <span className="orgcardname">{o.name}</span>
            <span className="orgcardsub">{o.subtitle}</span>
            <span className="orgcardplan">
              {PLAN_SHORT[o.plan] ?? o.plan}
              {o.billing_cycle ? `, ${o.billing_cycle}` : ''}
              {o.paid_through ? ` / paid through ${o.paid_through}` : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="btnrow"><button className="btn ghost" onClick={signOut}>Sign out</button></div>
    </div>
  );
}

const PLAN_SHORT = { free: 'Free tier', small: 'Up to 9 people', unlimited: 'Unlimited' };
