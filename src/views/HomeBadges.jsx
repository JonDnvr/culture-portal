import React, { useMemo, useState } from 'react';
import { Modal } from '../components/ui.jsx';
import { Flame, Seal, CairnStack, CairnDone } from '../components/badges.jsx';
import { RunList } from '../components/badgeDetails.jsx';
import {
  sessionRitualId, recentWeeks, botwStreak, practiceSummary, cairnFor
} from '../lib/gamify.js';

/**
 * Badges and streaks for the organization or the viewer's team. The toggle
 * sits in the block's own header bar, so it reads as belonging to these
 * badges and not to everything else on the home page.
 */
export default function HomeBadges({ ctx }) {
  const { org, rituals, activity, teams, myTeamId, term, isSuper, openPulse } = ctx;
  const team = teams.find((t) => t.id === myTeamId);
  const [scopeKind, setScopeKind] = useState('org');
  const [listOpen, setListOpen] = useState(false);

  const scope = scopeKind === 'team' && team ? { kind: 'team', teamId: team.id } : { kind: 'org' };
  const scopeName = scope.kind === 'team' ? team.name : org.name;

  const d = useMemo(() => {
    const sessionId = sessionRitualId(rituals);
    const rw = recentWeeks(org);
    return {
      rw,
      streak: botwStreak(activity.iterations, sessionId, scope),
      practice: practiceSummary(activity.iterations, sessionId, scope, rw),
      // The pulse runs across the whole organization, so the cairn is the same
      // under either toggle.
      cairn: activity.pulseStatus ? cairnFor(activity.pulseStatus) : null
    };
  }, [org, rituals, activity, scope.kind, scope.teamId]);

  const { streak, practice, cairn, rw } = d;
  const toGo = cairn ? Math.max(0, cairn.total - cairn.scored) : 0;

  return (
    <section className="homebadges">
      <div className="scopebar">
        <div>
          <div className="scopelabel">Badges and streaks</div>
          <div className="scopenote">Showing badges for <b>{scopeName}</b></div>
        </div>
        {team && (
          <div className="seg" role="group" aria-label="Show badges for">
            <button aria-pressed={scope.kind === 'org'} onClick={() => setScopeKind('org')}>{org.name}</button>
            <button aria-pressed={scope.kind === 'team'} onClick={() => setScopeKind('team')}>{team.name}</button>
          </div>
        )}
      </div>

      <div className="home3">
        <div className="hcard">
          <div className="hlabel">{term.One} of the Week</div>
          <div className="hsub">{streak.weeks} consecutive week{streak.weeks === 1 ? '' : 's'} with a discussion recorded</div>
          <div className="botwrow">
            <span className="pairh">
              <Flame n={streak.weeks} size={50} />
              <span className="lbl ember">weeks<br />in a row</span>
            </span>
            <span className="pairh">
              <Seal size={44} months={streak.seal.months} tier={Math.max(1, streak.seal.tier)} />
              <span className="lbl gold">
                {streak.seal.name ?? 'First seal at 4 weeks'}
                <small>{streak.seal.months} of 12 months</small>
              </span>
            </span>
          </div>
          <div className="weekdots" title="Each dot is a week, labelled by the Monday it starts">
            {streak.dots.map((w, i) => {
              const [y, m, d] = w.key.split('-').map(Number);
              const date = new Date(y, m - 1, d);
              const prev = i > 0 ? Number(streak.dots[i - 1].key.split('-')[1]) : null;
              return (
                <span key={w.key} className={`wk${w.current ? ' now' : ''}`}>
                  <em>{i === 0 || prev !== m ? date.toLocaleDateString(undefined, { month: 'short' }) : '\u00a0'}</em>
                  <i className={w.count ? (i < 6 ? 'lo' : '') : 'off'} />
                  <span>{d}</span>
                </span>
              );
            })}
          </div>
        </div>

        <button className="hcard hbtn" onClick={() => setListOpen(true)}>
          <div className="hlabel">Practiced this week</div>
          <div className="hsub">Rituals and systems recorded against a {term.one}</div>
          <div className="bigstat">
            <span className="n">{practice.thisWeek.length}</span>
            <span className="cap">{practice.recent.length} in the last {rw} weeks</span>
          </div>
          <span className="more">See what was counted →</span>
        </button>

        <div className="hcard">
          <div className="hlabel">Survey cadence</div>
          <div className="hsub">Pulse answers gathered toward the next round</div>
          {cairn && cairn.total > 0 ? (
            <>
              <div className="milerow">
                {cairn.completed > 0 && (
                  <span className="pairh">
                    <CairnDone size={36} rounds={cairn.completed} />
                    <span className="lbl gold">{cairn.completed} round{cairn.completed === 1 ? '' : 's'}<small>complete</small></span>
                  </span>
                )}
                <span className="pairh">
                  <CairnStack size={36} filled={cairn.filled} />
                  <span className="lbl">{cairn.scored} of {cairn.total}<small>{term.many} answered</small></span>
                </span>
              </div>
              <div className="mileline">
                {toGo === 0
                  ? `Round ${cairn.round} is complete.`
                  : `Answer pulse questions at login to give feedback on ${toGo} more ${term.n(toGo)} to complete this round.`}
              </div>
              {!isSuper && toGo > 0 && (
                <div className="btnrow" style={{ marginTop: 8 }}>
                  <button className="btn small" onClick={openPulse}>Rate now</button>
                </div>
              )}
            </>
          ) : <div className="quiet" style={{ marginTop: 10 }}>The pulse has not started yet.</div>}
        </div>
      </div>

      {listOpen && (
        <Modal title="Practiced this week" onClose={() => setListOpen(false)} wide
          footer={<button className="btn ghost" onClick={() => setListOpen(false)}>Close</button>}>
          <p className="meta">
            {practice.thisWeek.length} ritual and system run{practice.thisWeek.length === 1 ? '' : 's'} recorded
            this week for {scopeName}. Each opens its record.
          </p>
          <RunList ctx={ctx} rows={practice.thisWeek} onClose={() => setListOpen(false)}
            empty="Nothing recorded yet this week." />
          {practice.recent.length > practice.thisWeek.length && (
            <>
              <h4 className="fl">Earlier in the last {rw} weeks</h4>
              <RunList ctx={ctx} onClose={() => setListOpen(false)}
                rows={practice.recent.filter((x) => !practice.thisWeek.includes(x))} empty="" />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
