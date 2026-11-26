import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { taskBread } from './task-identity.mjs';

const labels = { running: 'Working on it', queued: 'Queued', review: 'Needs you', completed: 'Done', failed: 'Needs attention', interrupted: 'Interrupted', stopped: 'Stopped', unconfirmed: 'Unconfirmed' };
export function taskHandoff({ id, title, state, continuing = false, open }) {
  const button = element('button', undefined, 'quiet task-handoff'); button.type = 'button';
  const bread = element('span', taskBread(id), 'task-bread'); bread.setAttribute('aria-hidden', 'true');
  const copy = element('span', undefined, 'task-handoff-copy');
  const name = String(title || 'Your request').slice(0, 180);
  const action = continuing ? 'Continued task' : 'Opened task', status = labels[state] || 'Awaiting confirmation';
  copy.append(element('small', action, 'hint'), element('span', name, 'task-handoff-title'));
  const progress = element('span', status, 'task-handoff-status hint');
  button.append(bread, copy, progress, icon('chevron-right'));
  button.setAttribute('aria-label', `${action}: ${name} · ${status} · Open task details`);
  button.addEventListener('click', open);
  return button;
}
