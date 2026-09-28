/**
 * Which 5C categories a behavior belongs to: the one set on the behavior, and
 * the category of each of its values. A behavior carrying a Character value
 * and a Change value is in both, so every category filter and count shows it
 * under each, the same way the value and system filters already do.
 */
export function categoriesOf(behavior) {
  if (!behavior) return [];
  const names = [behavior.category, ...(behavior.values ?? []).map((v) => v.category)];
  return [...new Set(names.filter(Boolean))];
}

/** Whether a behavior belongs to a category, by the rule above. */
export const inCategory = (behavior, name) => categoriesOf(behavior).includes(name);
