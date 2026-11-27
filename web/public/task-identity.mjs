import bakery from '/bakery.json' with { type: 'json' };
// A task keeps its bread across reloads and follow-ups; titles remain its identifier.
const breads = ['🥐', '🥖', '🥯', '🍞', '🥨'];
export function taskBread(id, assigned) {
  if (bakery.includes(assigned)) return assigned;
  let hash = 2166136261;
  for (const character of String(id || '')) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return breads[hash % breads.length];
}
