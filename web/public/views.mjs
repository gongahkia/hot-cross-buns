import { element } from './text.mjs';
import { icon } from './icons.mjs';

function action(label, glyph, description, run) {
  const node = element('button', undefined, 'view-link'); node.type = 'button';
  const text = element('span'); text.append(element('strong', label), element('small', description));
  node.append(icon(glyph), text, icon('chevron-right')); node.addEventListener('click', run); return node;
}
export function settingsView({ state = {}, scheduled = {}, navigate, backend, reactionMode = 'subtle', setReactionMode }) {
  const root = element('section', undefined, 'settings-view');
  root.append(element('p', 'Your assistant, models, and local data.', 'hint'));
  const status = element('dl', undefined, 'view-facts');
  for (const [name, value] of [['Chat model', state.model || 'No model selected'], ['Local scheduler', scheduled.running ? 'Running' : 'Stopped']]) status.append(element('dt', name), element('dd', value));
  root.append(status);
  const groups = [
    ['Assistant', [
      ['Models', 'cpu', 'Choose a chat model or configure a provider.', () => navigate('/model')],
      ['Connections', 'link', 'Accounts, connected sources, and their permissions.', () => navigate('/connections')],
      ['Web search', 'search', 'Choose a search service and check its access.', () => backend('/search')],
      ['Memory & privacy', 'brain', 'Chat learning, earlier-chat retrieval, and recall settings.', () => backend('/memory')],
      ['Skills and routines', 'book-open', 'Inspect saved procedures and manage future availability.', () => backend('/routines')],
      ['Scheduled tasks', 'calendar-days', 'Recurring checks and ongoing responsibilities.', () => navigate('/scheduled')],
    ]],
    ['This device', [
      ['Permissions', 'eye', 'Live filesystem access, saved folders, and app capabilities.', () => backend('/permissions')],
      ['Computer access', 'cpu', 'Share an app for one task and pause for private takeover.', () => backend('/computer')],
      ['Browser access', 'globe', 'Choose a private browser, allowed sites, and tabs for a task.', () => backend('/browser')],
      ['Usage & limits', 'chart-no-axes-combined', 'Provider usage and shared request limits.', () => backend('/usage')],
      ['Data & backups', 'folder-search', 'Retained data, exports, and restore reviews.', () => backend('/data')],
      ['Recovery', 'rotate-ccw', 'Review interrupted work and setup that needs attention.', () => backend('/recovery')],
    ]],
  ];
  for (const [name, links] of groups) {
    root.append(element('h3', name));
    for (const item of links) root.append(action(...item));
  }
  if (setReactionMode) {
    root.append(element('h3', 'Conversation'));
    const label = element('label', 'Quick acknowledgements');
    const select = element('select'); select.setAttribute('aria-label', 'Quick acknowledgements');
    for (const [value, text] of [['off', 'Off · keep text replies'], ['subtle', 'Subtle'], ['expressive', 'Expressive · include greetings']]) {
      const option = element('option', text); option.value = value; select.append(option);
    }
    select.value = reactionMode; select.addEventListener('change', () => setReactionMode(select.value)); label.append(select);
    root.append(label, element('p', 'Show confirmed conversational acknowledgements as small emoji beside your message. This only changes display in this browser; it never approves work or asks the model for reactions.', 'hint'));
  }
  return root;
}
