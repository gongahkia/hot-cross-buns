import { element } from './text.mjs';

const kinds = {
  silent: ['', 'subtle', 'Acknowledged.', ''],
  ...Object.fromEntries(['👍','❤️','😂','😮','😢','🎉'].map(emoji => [emoji, [emoji, 'subtle', emoji, 'Hot Cross Buns reacted with ' + emoji]])),
  appreciation: ['❤️', 'subtle', "You're welcome.", 'Acknowledged with a heart'],
  laughter: ['😂', 'subtle', 'Haha!', 'Acknowledged with laughter'],
  praise: ['🙌', 'subtle', 'Thanks for the kind words.', 'Acknowledged with raised hands'],
  farewell: ['👋', 'subtle', 'Take care!', 'Acknowledged with a farewell wave'],
  greeting: ['👋', 'expressive', 'Hello!', 'Acknowledged with a greeting wave'],
};
export function reactionPreference(value) {
  const key = 'hot-cross-buns.web.reactions.v1';
  if (['off', 'subtle', 'expressive'].includes(value)) {
    try { window.localStorage.setItem(key, value); } catch { /* keep the choice for this page when storage is blocked. */ }
    return value;
  }
  try { const saved = window.localStorage.getItem(key); return ['off', 'subtle', 'expressive'].includes(saved) ? saved : 'subtle'; }
  catch { return 'subtle'; }
}
export function reactionFor(turn, conversation, mode = 'subtle') {
  const reaction = turn.reaction, expected = kinds[reaction?.kind];
  if (mode === 'off' && reaction?.kind !== 'silent' || !expected || !conversation || !turn.id || turn.state !== 'answered' || !turn.response || turn.issue || turn.task_chat || turn.input_ids?.length || turn.reply_to_update_id ||
      reaction.version !== 1 || reaction.conversation_id !== conversation || reaction.turn_id !== turn.id || !Number.isSafeInteger(reaction.revision) || reaction.revision <= 0 || turn.revision !== reaction.revision ||
      reaction.emoji !== expected[0] || reaction.level !== expected[1] || turn.response !== expected[2] || mode !== 'expressive' && reaction.level === 'expressive') return null;
  return { emoji: expected[0], label: expected[3], ...(reaction.kind === 'silent' ? { silent: true } : {}) };
}
export function reactionChip(reaction) {
  const chip = element('span', reaction.emoji, 'reaction-chip');
  chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', reaction.label + ' · conversational only');
  chip.title = 'Conversational acknowledgement; not approval or task completion.';
  return chip;
}
