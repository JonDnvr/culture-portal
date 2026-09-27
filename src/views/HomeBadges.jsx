import React, { useMemo, useState } from 'react';
import { Modal } from '../components/ui.jsx';
import { Flame, Seal, CairnStack, CairnDone } from '../components/badges.jsx';
import { RunList } from '../components/badgeDetails.jsx';
import {
  sessionRitualId, recentPeriods, botwStreak, practiceSummary, cairnFor, cadenceOf, UNIT
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
    const rw = recentPeriods(org);
    const cad = cadenceOf(org);
    return {
      rw, cad,
      streak: botwStreak(activity.iterations, sessionId, scope, new Date(), cad),
      practice: practiceSummary(activity.iterations, sessionId, scope, rw, new Date(), cad),
      // The pulse runs across the whole organization, so the cairn is the same
      // under either toggle.
      cairn: activity.pulseStatus ? cairnFor(activity.pulseStatus) : null
    };
  }, [org, rituals, activity, scope.kind, scope.teamId]);

  const { streak, practice, cairn, rw, cad } = d;
  const unit = UNIT[cad.kind];
  const plural = (n) => (n === 1 ? unit.one : unit.many);
  const mineLeft = cairn?.mineLeft ?? 0;

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
          <div className="hlabel">{term.One} of the {cad.kind === 'daily' ? 'Day' : cad.kind === 'monthly' ? 'Month' : 'Week'}</div>
          <div className="hsub">{streak.count} consecutive {plural(streak.count)} with a discussion recorded</div>
          <div className="botwrow">
            <span className="pairh">
              <Flame n={streak.weeks} size={50} />
              <span className="lbl ember">{unit.many}<br />in a row</span>
            </span>
            <span className="pairh">
              <Seal size={44} months={streak.seal.months} tier={Math.max(1, streak.seal.tier)} />
              <span className="lbl gold">
                {streak.seal.name ?? `First seal at ${streak.seal.first} ${plural(streak.seal.first)}`}
                <small>{streak.seal.months} of 12 months</small>
              </span>
            </span>
          </div>
          <div className="weekdots" title={`Each dot is a ${unit.one}, labelled by the day it starts`}>
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
          <div className="hlabel">Practiced {unit.this}</div>
          <div className="hsub">Rituals and systems recorded against a {term.one}</div>
          <div className="bigstat">
            <span className="n">{practice.thisWeek.length}</span>
            <span className="cap">{practice.recent.length} in the last {rw} {plural(rw)}</span>
          </div>
          <span className="more">See what was counted →</span>
        </button>

        <div className="hcard">
          <div className="hlabel">Survey cadence</div>
          <div className="hsub">Round {cairn?.round ?? 1}: complete when 80% of members have rated every {term.one}</div>
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
                  <span className="lbl">{cairn.done} of {cairn.target}<small>people finished</small></span>
                </span>
              </div>
              <div className="mileline">
                {isSuper
                  ? `${cairn.done} of ${cairn.members} members have rated all ${cairn.total}. The round needs ${cairn.target}.`
                  : mineLeft > 0
                    ? `You have ${mineLeft} ${term.n(mineLeft)} left to rate this round. ${Math.max(0, cairn.target - cairn.done)} more ${cairn.target - cairn.done === 1 ? 'person' : 'people'} to finish it.`
                    : `You have rated every ${term.one} this round. ${Math.max(0, cairn.target - cairn.done)} more ${cairn.target - cairn.done === 1 ? 'person' : 'people'} to finish it.`}
              </div>
              {!isSuper && mineLeft > 0 && (
                <div className="btnrow" style={{ marginTop: 8 }}>
                  <button className="btn small" onClick={openPulse}>Rate now</button>
                </div>
              )}
            </>
          ) : <div className="quiet" style={{ marginTop: 10 }}>The pulse has not started yet.</div>}
        </div>
      </div>

      {listOpen && (
        <Modal title={`Practiced ${unit.this}`} onClose={() => setListOpen(false)} wide
          footer={<button className="btn ghost" onClick={() => setListOpen(false)}>Close</button>}>
          <p className="meta">
            {practice.thisWeek.length} ritual and system run{practice.thisWeek.length === 1 ? '' : 's'} recorded
            {unit.this} for {scopeName}. Each opens its record.
          </p>
          <RunList ctx={ctx} rows={practice.thisWeek} onClose={() => setListOpen(false)}
            empty={`Nothing recorded yet ${unit.this}.`} />
          {practice.recent.length > practice.thisWeek.length && (
            <>
              <h4 className="fl">Earlier in the last {rw} {plural(rw)}</h4>
              <RunList ctx={ctx} onClose={() => setListOpen(false)}
                rows={practice.recent.filter((x) => !practice.thisWeek.includes(x))} empty="" />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
