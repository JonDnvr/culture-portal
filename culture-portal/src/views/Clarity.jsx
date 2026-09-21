import React, { useState, useMemo } from 'react';
import { pad, Tag, BNum } from '../components/ui.jsx';

const ALL = 'All';
const UNAPPLIED = '__none__';

/**
 * Filters stack in the order the team thinks in: which value are we talking
 * about, where is it built in, and which category does it belong to.
 */
export default function Clarity({ ctx }) {
  const { behaviors, values, systems, categories, rituals, openBehavior, org } = ctx;
  const [value, setValue] = useState(ALL);
  const [system, setSystem] = useState(ALL);
  const [category, setCategory] = useState(ALL);

  const counts = useMemo(() => ({
    value: Object.fromEntries(values.map((v) =>
      [v.name, behaviors.filter((b) => b.values.some((x) => x.id === v.id)).length])),
    system: Object.fromEntries(systems.map((s) =>
      [s.name, behaviors.filter((b) => b.placements.some((p) => p.systemId === s.id)).length])),
    category: Object.fromEntries(categories.map((c) =>
      [c.name, behaviors.filter((b) => b.category === c.name).length])),
    unapplied: behaviors.filter((b) => b.placements.length === 0).length
  }), [behaviors, values, systems, categories]);

  const list = behaviors.filter((b) => {
    if (value !== ALL && !b.values.some((v) => v.name === value)) return false;
    if (system === UNAPPLIED && b.placements.length > 0) return false;
    if (system !== ALL && system !== UNAPPLIED && !b.placements.some((p) => p.system === system)) return false;
    if (category !== ALL && b.category !== category) return false;
    return true;
  });

  const filtered = value !== ALL || system !== ALL || category !== ALL;
  const clear = () => { setValue(ALL); setSystem(ALL); setCategory(ALL); };

  return (
    <>
      <div className="dateline">{behaviors.length} behaviors, numbered for reference</div>
      <h1 className="pagetitle">Clarity</h1>
      <p className="lede">Behaviors written as verbs, filed by value, system and category, specific enough to observe.</p>

      <FilterRow label="Value" value={value} onChange={setValue}
        options={values.map((v) => ({ key: v.name, label: v.name, count: counts.value[v.name] }))} />

      <FilterRow label="Category" value={category} onChange={setCategory}
        options={categories.map((c) => ({ key: c.name, label: c.name, count: counts.category[c.name] }))} />

      <div className="filterline">
        <span className="fl2">System</span>
        <select className="field inline" value={system} onChange={(e) => setSystem(e.target.value)}>
          <option value={ALL}>All systems</option>
          {systems.map((s) => (
            <option key={s.id} value={s.name}>{s.name} ({counts.system[s.name]})</option>
          ))}
          <option value={UNAPPLIED}>Not applied to any system ({counts.unapplied})</option>
        </select>
      </div>
      <div className="filterspace" />

      {filtered && (
        <div className="filterline" style={{ marginTop: 12 }}>
          <span className="fl2" />
          <span className="meta">Showing {list.length} of {behaviors.length} behaviors</span>
          <button className="btn ghost small" onClick={clear}>Clear filters</button>
        </div>
      )}

      <section>
        {list.length ? (
          <div className="grid">
            {list.map((b) => (
              <button key={b.id} className="fcard" onClick={() => openBehavior(b.id)}>
                <h3><BNum n={b.number} /> {b.title}</h3>
                <p>{b.description}</p>
                <div className="tagrow">
                  {b.values.map((v) => <Tag key={v.id} type="value">{v.name}</Tag>)}
                  <Tag type="category">{b.category}</Tag>
                  <Tag type="ritual">Rituals ({b.rituals.filter((r) => !r.applies_to_all).length + rituals.filter((r) => r.applies_to_all).length})</Tag>
                  {b.placements.length
                    ? <Tag type="system">{b.placements.map((p) => p.system).join(', ')}</Tag>
                    : <Tag type="warn">No system</Tag>}
                  {b.placements.length === 1 && <Tag type="warn">Thin support</Tag>}
                  {org.weekly_behavior_id === b.id && <Tag type="live">This week</Tag>}
                  {b.is_example && <Tag type="warn">Example</Tag>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">No behaviors match that combination. That is usually the finding, not a dead end.</div>
        )}
      </section>
    </>
  );
}

function FilterRow({ label, value, onChange, options }) {
  return (
    <div className="filterline">
      <span className="fl2">{label}</span>
      <button className="pill" aria-pressed={value === ALL} onClick={() => onChange(ALL)}>All</button>
      {options.map((o) => (
        <button key={o.key} className="pill" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label} ({o.count})
        </button>
      ))}
    </div>
  );
}
