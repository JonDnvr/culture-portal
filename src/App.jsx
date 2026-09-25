import React, { useEffect, useState, useCallback } from 'react';
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
import { Avatar } from './components/ui.jsx';
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

const NAV = [
  { id: 'home', label: 'Culture home', sub: 'Purpose, values, this week', roles: ALL_ROLES },
  { id: 'clarity', label: 'Clarity', sub: (t) => `The ${t.many}`, roles: ALL_ROLES },
  { id: 'cadence', label: 'Cadence', sub: 'Practice and rituals', roles: ALL_ROLES },
  { id: 'connection', label: 'Connection', sub: 'Recognition and stories', roles: ALL_ROLES },
  { id: 'conviction', label: 'Conviction', sub: 'Is it holding?', roles: ['leader', ...EDITORS] }
];

// Apart from the working sections, at the foot of the navigation: the wall,
// then Admin.
const FOOT = [
  { id: 'wall', label: 'Trophy Wall', sub: 'What has been earned', roles: ALL_ROLES },
  { id: 'admin', label: 'Admin', sub: 'Content, systems, people', roles: EDITORS }
];

const ROLE_LABEL = {
  member: 'Member', leader: 'Leader', admin: 'Admin',
  champion: 'Culture champion', owner: 'Super user'
};

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
        soft(listAwardTypes(org.id), []), soft(listAwardGrants(org.id), []),
        soft(listIterations(org.id), []), soft(listRecognitions(org.id), []), soft(listStories(org.id), []),
        soft(listMyFluencyMarks(org.id), []),
        soft(getPulseStatus(org.id), null), soft(getPulseSpreadByRound(org.id), [])
      ]);
      setData({
        values, systems, behaviors, rituals, categories, people, teams, awardTypes, grants,
        activity: { iterations, recognitions, stories, fluencyMarks, pulseStatus, pulseSpread }
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
      soft(listIterations(org.id), null), soft(listRecognitions(org.id), null), soft(listStories(org.id), null),
      soft(listMyFluencyMarks(org.id), null), soft(getPulseStatus(org.id), null),
      soft(getPulseSpreadByRound(org.id), null), soft(listAwardGrants(org.id), null)
    ]);
    setData((d) => d && ({
      ...d,
      grants: grants ?? d.grants,
      activity: {
        iterations: iterations ?? d.activity.iterations,
        recognitions: recognitions ?? d.activity.recognitions,
        stories: stories ?? d.activity.stories,
        fluencyMarks: fluencyMarks ?? d.activity.fluencyMarks,
        pulseStatus: pulseStatus ?? d.activity.pulseStatus,
        pulseSpread: pulseSpread ?? d.activity.pulseSpread
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
    canEdit: EDITORS.includes(role),
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

  return (
    <div className="shell" style={{ '--accent': org.accent || '#9C7A3C' }}>
      <aside className="rail">
        <div className="brandmark">
          <div className="chip" style={{ background: org.accent }}>{org.initials}</div>
          <div>
            <div className="orgname">{org.name}</div>
            <div className="orgmeta">{org.subtitle}</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => <NavButton key={n.id} n={n} term={term} current={view === n.id} onGo={ctx.goto} accent={org.accent} />)}
          <div className="navwall">
            {foot.map((n) => <NavButton key={n.id} n={n} term={term} current={view === n.id} onGo={ctx.goto} accent={org.accent} />)}
          </div>
        </nav>
        <div className="railfoot">
          {isSuper && orgs.length > 1 && (
            <>
              <label htmlFor="orgSel">Organization</label>
              <select id="orgSel" value={org.id} onChange={(e) => ctx.switchOrg(e.target.value)}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </>
          )}
          <div className="credit">
            <button className="mebtn" onClick={() => setProfileOpen(true)} title="Your picture">
              <Avatar person={me} name={org.displayName} size={28} />
              <span>{org.displayName}<br /><small>Your picture</small></span>
            </button>
            <span className="rolechip">{ROLE_LABEL[role]}{isSuper ? ', all organizations' : ''}</span><br />
            <button className="linkbtn" onClick={signOut}>Sign out</button>
            {IS_LOCAL && isSuper && (
              <> &nbsp;/&nbsp; <button className="linkbtn" onClick={() => { resetLocalData(); signOut(); }}>Reset demo data</button></>
            )}
          </div>
        </div>
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
          {view === 'record' && detail?.kind === 'story' && <StoryPage ctx={ctx} id={detail.id} />}
          {view === 'record' && detail?.kind === 'recognition' && <RecognitionPage ctx={ctx} id={detail.id} />}
          {view === 'record' && detail?.kind === 'iteration' && <IterationPage ctx={ctx} id={detail.id} />}
          {view === 'record' && detail?.kind === 'ritual' && <RitualPage ctx={ctx} id={detail.id} />}
        </div>
      </main>
      {profileOpen && <ProfileDialog ctx={ctx} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

/** A section in the rail, with its icon in the organization's highlight color. */
function NavButton({ n, term, current, onGo, accent }) {
  return (
    <button className="navitem" aria-current={current ? 'page' : undefined} onClick={() => onGo(n.id)}>
      <span className="navicon" style={{ color: accent || 'var(--accent)' }}><NavIcon id={n.id} /></span>
      <span className="navtext">{n.label}<br /><small>{typeof n.sub === 'function' ? n.sub(term) : n.sub}</small></span>
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
