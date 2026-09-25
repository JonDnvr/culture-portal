import React, { useState } from 'react';
import { N, Tag } from '../components/ui.jsx';
import HomeBadges from './HomeBadges.jsx';

export default function Home({ ctx }) {
  const { org, behaviors, values, goto, openBehavior, term } = ctx;
  const [openValue, setOpenValue] = useState(null);
  const week = behaviors.find((b) => b.id === org.weekly_behavior_id) ?? behaviors[0];
  const countFor = (v) => behaviors.filter((b) => b.values.some((x) => x.id === v.id)).length;

  return (
    <>
      <div className="dateline">Week of {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>
      <h1 className="pagetitle">{org.name}</h1>
      <p className="lede">{org.creed}</p>
      {org.has_example_content && (
        <div className="notice examplenotice">
          Some of this is example content, marked with an Example tag. Edit a value or a {term.one}
          to make it yours, or clear the rest from Admin.
        </div>
      )}

      {week && (
        <section>
          <div className="sectionhead"><h2>This week</h2><span className="note">Rotates Monday</span></div>
          <div className="bigcard">
            <div className="kicker"><N n={week.number} dot={false} /> / {week.category} / {week.values.map((v) => v.name).join(', ')}</div>
            <h2>{week.title}</h2>
            <p className="desc">{week.description}</p>
            <div className="btnrow">
              <button className="btn" onClick={() => goto('cadence')}>Practice it</button>
              <button className="btn ghost" onClick={() => openBehavior(week.id)}>Full {term.one}</button>
            </div>
          </div>
        </section>
      )}

      <HomeBadges ctx={ctx} />

      <section>
        <div className="sectionhead"><h2>Purpose</h2></div>
        <div className="block"><h4>Shared purpose/mission</h4><p>{org.mission}</p></div>
        <div className="block"><h4>Vision/Where we are going</h4><p>{org.vision}</p></div>
      </section>

      <section>
        <div className="sectionhead"><h2>Values</h2><span className="note">Each one carried by {term.many}</span></div>
        <div className="vgrid">
          {values.map((v) => {
            const carried = behaviors.filter((b) => b.values.some((x) => x.id === v.id));
            const open = openValue === v.id;
            return (
              <div key={v.id} className="vcard">
                <h3>{v.name}</h3>
                {v.is_example && <div className="tagrow"><Tag type="warn">Example</Tag></div>}
                <p>{v.description}</p>
                <button className="cnt linkbtn" aria-expanded={open}
                  onClick={() => setOpenValue(open ? null : v.id)}>
                  {term.Many} ({carried.length}) {open ? '▴' : '▾'}
                </button>
                {open && (
                  <ul className="vlist">
                    {carried.map((b) => (
                      <li key={b.id}>
                        <button className="linkbtn" onClick={() => openBehavior(b.id)}>
                          <N n={b.number} /> {b.title}
                        </button>
                      </li>
                    ))}
                    {!carried.length && <li className="quiet">No {term.one} carries this value yet.</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="sectionhead">
          <h2>All {term.many}</h2>
          <span className="note">{behaviors.length} in practice</span>
        </div>
        <p className="prose">
          Every behavior, with its coaching, teaching points, discussion questions, the
          systems that hold it and the rituals that carry it.
        </p>
        <div className="btnrow">
          <button className="btn" onClick={() => goto('clarity')}>See the full list</button>
          <button className="btn ghost" onClick={() => openHandout(org, values, behaviors, false, term)}>Open the handout</button>
          <button className="btn ghost" onClick={() => openHandout(org, values, behaviors, true, term)}>Open the full handout</button>
        </div>
        <p className="meta" style={{ marginTop: 8 }}>
          The handout is the one-line-per-{term.one} version for a meeting. The full handout adds
          the coaching tips, teaching points, discussion questions, failure state and rule, for
          whoever is leading. Both open as a clean page you can print or save as a PDF.
        </p>
      </section>
    </>
  );
}

/**
 * Builds the handout as its own page rather than printing the app. Two
 * depths: the short one for the room, the full one for whoever is leading.
 */
function openHandout(org, values, behaviors, full, term) {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => String(n).padStart(2, '0');
  const list = (items, title) => (items?.length
    ? `<div class="detail"><span class="dlabel">${title}</span><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    : '');
  const line = (text, title) => (text
    ? `<div class="detail"><span class="dlabel">${title}</span><p>${esc(text)}</p></div>`
    : '');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(org.name)} — ${esc(term.many)}${full ? ', full' : ''}</title>
<style>
  :root{
    --ink:#151A18;--soft:#3E4A46;--muted:#5F6C67;--line:#D4DAD6;
    --accent:${esc(org.accent || '#9C7A3C')};
    --value:#B5541C;--category:#4F7052;
  }
  *{box-sizing:border-box}
  body{margin:0;background:#f4f5f3;color:var(--ink);
    font-family:Georgia,'Times New Roman',serif;line-height:1.55}
  .sheet{max-width:820px;margin:28px auto;background:#fff;padding:44px 52px;
    box-shadow:0 1px 4px rgba(0,0,0,.12)}
  header{border-bottom:3px solid var(--accent);padding-bottom:14px;margin-bottom:22px}
  h1{font-size:30px;margin:0}
  .sub{font-family:system-ui,sans-serif;font-size:12px;color:var(--muted);margin-top:4px}
  .creed{font-style:italic;color:var(--soft);margin:12px 0 0}
  h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  .values li{margin-bottom:5px}
  .values strong{color:var(--value)}
  .behavior{break-inside:avoid;page-break-inside:avoid;border-bottom:1px dotted #c9cfcb;
    padding-bottom:12px;margin-bottom:14px}
  .behavior h3{font-size:16px;margin:0 0 5px}
  .bnum{color:var(--accent);font-weight:700}
  .tags{font-family:system-ui,sans-serif;font-size:10px;letter-spacing:.04em;
    text-transform:uppercase;margin:0 0 6px;display:flex;flex-wrap:wrap;gap:5px}
  .tag{border:1px solid currentColor;border-radius:3px;padding:1px 5px}
  .tag.v{color:var(--value)} .tag.c{color:var(--category)}
  .detail{margin-top:7px;font-size:12.5px;color:var(--soft)}
  .detail ul{margin:2px 0 0;padding-left:16px}
  .detail p{margin:2px 0 0}
  .dlabel{font-family:system-ui,sans-serif;font-size:9.5px;letter-spacing:.06em;
    text-transform:uppercase;color:var(--accent);display:block}
  .toolbar{max-width:820px;margin:18px auto 0;display:flex;gap:10px;justify-content:flex-end;
    font-family:system-ui,sans-serif}
  .toolbar button{font:inherit;font-size:13px;padding:8px 14px;border-radius:4px;
    border:1px solid var(--line);background:#fff;cursor:pointer}
  footer{margin-top:26px;font-family:system-ui,sans-serif;font-size:10.5px;color:var(--muted)}
  @media print{
    body{background:#fff}.toolbar{display:none}
    .sheet{box-shadow:none;margin:0;padding:0;max-width:none}
    @page{margin:16mm}
  }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="sheet">
  <header>
    <h1>${esc(org.name)}</h1>
    ${org.subtitle ? `<div class="sub">${esc(org.subtitle)}</div>` : ''}
    ${org.creed ? `<p class="creed">${esc(org.creed)}</p>` : ''}
  </header>

  <div class="cols">
    <div><h2>Shared purpose/mission</h2><p>${esc(org.mission)}</p></div>
    <div><h2>Vision/Where we are going</h2><p>${esc(org.vision)}</p></div>
  </div>

  <h2>Values</h2>
  <ul class="values">
    ${values.map((v) => `<li><strong>${esc(v.name)}.</strong> ${esc(v.description)}</li>`).join('')}
  </ul>

  <h2>${esc(term.Many)}</h2>
  ${behaviors.map((b) => `
    <div class="behavior">
      <h3><span class="bnum">${num(b.number)}.</span> ${esc(b.title)}</h3>
      <div class="tags">
        ${b.values.map((v) => `<span class="tag v">${esc(v.name)}</span>`).join('')}
        <span class="tag c">${esc(b.category)}</span>
      </div>
      <p>${esc(b.description)}</p>
      ${full ? [
        line(b.quick_tip, 'Try this'),
        list(b.coaching_tips, 'Coaching tips'),
        list(b.teaching_points, 'Teaching points'),
        list(b.questions, 'Questions for discussion'),
        line(b.failure_state, 'When we miss'),
        line(b.hard_rule, 'The rule that makes it real')
      ].join('') : ''}
    </div>`).join('')}

  <footer>${esc(org.name)} culture portal${full ? ', full handout' : ''} &nbsp;/&nbsp; ${new Date().toLocaleDateString()}</footer>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
