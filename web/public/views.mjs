import { element, prose } from './text.mjs';
import { icon } from './icons.mjs';
import { samples } from './output-samples.mjs';

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
      ['Memory & privacy', 'brain', 'Chat learning, earlier-chat retrieval, and recall settings.', () => backend('/memory')],
      ['Scheduled tasks', 'calendar-days', 'Recurring checks and ongoing responsibilities.', () => navigate('/scheduled')],
    ]],
    ['This device', [
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

const previews = [
  ['Text & tables', 'file-text', 0], ['Code', 'code', 5], ['HTML', 'code', 1],
  ['SVG', 'chart-no-axes-combined', 2], ['Diagrams', 'workflow', 3],
  ['GIF', 'eye', 4], ['Math', 'list-checks', 6], ['Interactive', 'pencil', 7], ['Animation', 'play', 8],
];
export function outputPreview() {
  const root = element('section', undefined, 'output-gallery');
  root.append(element('p', 'Sample outputs using the same renderer as your chats. Interactive examples run in isolated previews.', 'hint'));
  const tabs = element('div', undefined, 'view-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Output types');
  const body = element('div', undefined, 'output-example'); body.setAttribute('role', 'tabpanel'); body.id = 'output-example';
  function show(index) {
    for (const [i, tab] of [...tabs.children].entries()) { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; }
    body.setAttribute('aria-labelledby', 'output-tab-' + index);
    const sample = samples[previews[index][2]];
    body.replaceChildren(element('p', sample[0], 'hint'), prose(sample[1]));
  }
  for (const [index, [name, glyph]] of previews.entries()) {
    const tab = element('button', name, 'quiet'); tab.type = 'button'; tab.id = 'output-tab-' + index;
    tab.prepend(icon(glyph)); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', body.id);
    tab.addEventListener('click', () => show(index));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? previews.length - 1 : (index + offset + previews.length) % previews.length;
      show(next); tabs.children[next].focus();
    });
    tabs.append(tab);
  }
  root.append(tabs, body); show(0); return root;
}
