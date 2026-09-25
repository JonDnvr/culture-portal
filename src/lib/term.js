/**
 * What this organization calls its behaviors. Set in Admin; "behavior" and
 * "behaviors" when nothing is set. Every screen reads its wording from here,
 * so a portal that says Foundations says it everywhere.
 */
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function termFor(org) {
  const one = String(org?.behavior_label ?? '').trim() || 'behavior';
  const many = String(org?.behavior_label_plural ?? '').trim()
    || (String(org?.behavior_label ?? '').trim() ? `${one}s` : 'behaviors');
  return {
    one: lower(one), many: lower(many),
    One: upper(one), Many: upper(many),
    /** "1 foundation", "3 foundations" */
    count: (n) => `${n} ${n === 1 ? lower(one) : lower(many)}`,
    /** singular or plural for a count, lower case */
    n: (k) => (k === 1 ? lower(one) : lower(many)),
    N: (k) => (k === 1 ? upper(one) : upper(many))
  };
}
