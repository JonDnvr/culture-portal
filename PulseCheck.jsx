import React, { useEffect, useState } from 'react';
import { getPulseAssignment, submitPulse } from '../lib/api.js';
import { BNum, Modal, useToast } from '../components/ui.jsx';

const SCALE = [
  {
    v: 1, l: 'Rarely', head: 'We are starting from zero',
    lead: 'The behavior is rarely or never observed.',
    points: [
      'Team does not understand it or its purpose',
      'No evidence of effort, practice, or alignment',
      'Behavior is absent even when stakes are low'
    ]
  },
  {
    v: 2, l: 'Inconsistently', head: 'There is awareness, but not adoption',
    lead: 'The behavior appears occasionally, but not reliably.',
    points: [
      'Some individuals show it, others do not',
      'It collapses under pressure or time constraints',
      'Requires prompting or external accountability'
    ]
  },
  {
    v: 3, l: 'Growing', head: 'We have traction, but not cultural strength',
    lead: 'The behavior is present more often than not, but uneven.',
    points: [
      'Team understands it and attempts to apply it',
      'Quality varies by situation or person',
      'It is present in normal conditions but weak in high-stakes moments'
    ]
  },
  {
    v: 4, l: 'Consistently', head: 'This is becoming cultural muscle',
    lead: 'The behavior is reliable, high-quality, and visible across the team.',
    points: [
      'Demonstrated across roles, situations, and pressure',
      'Team members hold each other accountable',
      'It is part of the team\u2019s operating rhythm'
    ]
  },
  {
    v: 5, l: 'Exemplary', head: 'This is a signature behavior of our culture',
    lead: 'The behavior is mastered and contagious.',
    points: [
      'Team models the behavior for others',
      'It improves outcomes, relationships, and performance',
      'Team reinforces, teaches, and protects the behavior',
      'It drives rituals, systems, decisions, recognition, and norms'
    ]
  }
];

/**
 * An add-on to whatever the person came to do, not a gate. It sits above the
 * page, clearly labelled, and can be dismissed for the session. How many
 * behaviors appear is set by an administrator.
 */
export default function PulseCheck({ ctx }) {
  const { org, reload } = ctx;
  const [assignment, setAssignment] = useState(null);
  const [answers, setAnswers] = useState({});
  const [guide, setGuide] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(`pulse-skip-${org.id}`) === '1'; } catch { return false; }
  });
  const toast = useToast();

  useEffect(() => {
    getPulseAssignment(org.id).then(setAssignment).catch(() => setAssignment(null));
  }, [org.id]);

  // Nothing to ask about until the organization has written its own behaviors.
  if (dismissed || assignment?.waiting || !assignment?.behaviors?.length) return null;

  const done = assignment.behaviors.every((b) => answers[b.id]);

  function skip() {
    setDismissed(true);
    try { sessionStorage.setItem(`pulse-skip-${org.id}`, '1'); } catch { /* fine */ }
  }

  async function save() {
    try {
      await submitPulse(org.id, answers);
      toast(`Thank you. That is ${assignment.behaviors.length} more behavior${assignment.behaviors.length === 1 ? '' : 's'} covered.`);
      setDismissed(true);
      reload();
    } catch (e) { toast(e.message); }
  }

  return (
    <div className="pulsecheck">
      <div className="pulseinner">
        <div className="pulsebar">
          <span className="pulsetag">Quick pulse</span>
          <span className="meta">
            Round {assignment.round} &nbsp;/&nbsp; {assignment.behaviors.length} behavior{assignment.behaviors.length === 1 ? '' : 's'}, about 30 seconds
          </span>
          <button className="linkbtn" onClick={skip}>Dismiss</button>
        </div>

        <h2>Rate how well do these drive our high performing culture</h2>
        <p className="quiet">
          Everyone gets a different handful, so the whole list gets covered without anyone
          filling in a long survey. <button className="linkbtn" onClick={() => setGuide(true)}>What do the ratings mean?</button>
        </p>

        {assignment.behaviors.map((b) => (
          <div key={b.id} className="pulseitem">
            <h3><BNum n={b.number} /> {b.title}</h3>
            <p className="quiet">{b.description}</p>
            <div className="scale">
              {SCALE.map((s) => (
                <button key={s.v} className="pill" aria-pressed={answers[b.id] === s.v}
                  title={`${s.v} — ${s.l}: ${s.head}`}
                  onClick={() => setAnswers({ ...answers, [b.id]: s.v })}>
                  <span className="num">{s.v} — {s.l}:</span>
                  <span className="sig">{s.head}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="btnrow">
          <button className="btn" onClick={save} disabled={!done}>Submit</button>
          <button className="btn ghost" onClick={skip}>Not now</button>
        </div>
      </div>

      {guide && (
        <Modal title="What the ratings mean" onClose={() => setGuide(false)} wide
          footer={<button className="btn ghost" onClick={() => setGuide(false)}>Close</button>}>
          {SCALE.map((s) => (
            <div key={s.v} className="ratingblock">
              <h4>{s.v} — {s.l}</h4>
              <p className="ratinghead">{s.head}:</p>
              <p className="ratinglead">{s.lead}</p>
              <ul>{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
