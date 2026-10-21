/**
 * Which of the 6Cs a behavior carries (R7): the ones chosen on the behavior,
 * any number of them. Values carry no C. A behavior in two Cs shows under
 * each in every category filter and count.
 */
export function categoriesOf(behavior) {
  if (!behavior) return [];
  return [...new Set((behavior.categories ?? []).filter(Boolean))];
}

/** Whether a behavior carries a C. */
export const inCategory = (behavior, name) => categoriesOf(behavior).includes(name);

/**
 * The Cs an award touches: those carried by any behavior linked to the
 * Values it stands for. An award has no behavior of its own.
 */
export function categoriesOfValues(behaviors, valueIds) {
  const ids = new Set(valueIds ?? []);
  const out = new Set();
  for (const b of behaviors ?? []) {
    if ((b.values ?? []).some((v) => ids.has(v.id))) categoriesOf(b).forEach((c) => out.add(c));
  }
  return [...out];
}
