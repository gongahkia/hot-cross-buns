import { element, turn } from "./text.mjs";
import { taskInspector, composerProgress } from './task-inspector.mjs';
import { scheduledPane } from './scheduled.mjs';

import { samples } from './output-samples.mjs';

const title = document.getElementById('title');
title.textContent = 'A quieter Sunday';
document.title = 'Output preview · Hot Cross Buns';
title.after(element('p', 'Sample conversation', 'preview-note'));
document.getElementById('transcript').replaceChildren(...samples.flatMap(([request, response]) => [
  turn(request, true, 'You'), turn(response, false, 'Hot Cross Buns'),
]));
document.getElementById('history').remove();
const brand = document.getElementById('history-toggle');
brand.removeAttribute('aria-controls'); brand.removeAttribute('aria-expanded');
brand.addEventListener('click', () => location.assign('/'));
const message = document.getElementById('message');
message.placeholder = 'Try typing here…';
for (const id of ['attach', 'model-picker', 'effort', 'send']) document.getElementById(id).disabled = true;
document.getElementById('model-label').textContent = 'Preview';
document.getElementById('composer').addEventListener('submit', event => event.preventDefault());
const dialog = document.getElementById('detail');
document.getElementById('close-detail').addEventListener('click', () => dialog.close());
function showSample(title, text) {
  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-body').replaceChildren(element('p', 'Sample preview', 'hint'), element('p', text));
  dialog.showModal();
}
const now = Date.now(), ago = seconds => new Date(now - seconds * 1000).toISOString();
const helperSamples = [
  { id: 'sample-codex', engine: 'Codex', title: 'Review the small interface changes', assignment: 'Check the composer and suggest a few focused improvements.', state: 'running', active: true, current: false, canOpen: true, steps: [] },
  { id: 'sample-claude', engine: 'Claude Code', title: 'Check the calendar connection', assignment: 'The connection check is waiting for a choice in the original conversation.', state: 'waiting', active: true, current: false, canOpen: true, steps: [] },
  { id: 'sample-pi', engine: 'Pi', title: 'Read through the project notes', assignment: 'The notes are ready to bring back into the conversation.', state: 'completed', active: false, current: false, canOpen: true, steps: [] },
];
const inspector = taskInspector({ iconName: 'helpers', showEmpty: true, description: 'Sample delegated work. No coding tools are running.', openChat: async id => {
  const helper = helperSamples.find(helper => helper.id === id);
  if (helper) showSample(helper.engine, helper.assignment);
} });
inspector.update(helperSamples);
const nextMorning = new Date(); nextMorning.setUTCDate(nextMorning.getUTCDate() + 1); nextMorning.setUTCHours(1, 0, 0, 0);
const schedules = [
  { id: 'sample-morning', digest: 'sample', title: 'Morning notes', outcome: 'Bring together a short, useful start to the day.', timing: 'Every morning at 9:00', timezone: 'Asia/Singapore', next_due: nextMorning.toISOString(), enabled: true, editable: true },
  { id: 'sample-weekly', digest: 'sample', title: 'A weekly look back', outcome: 'Gather the things worth remembering from the week.', timing: 'Every week', timezone: 'Asia/Singapore', next_due: new Date(nextMorning.getTime() + 6 * 86400000).toISOString(), enabled: true, editable: true },
  { id: 'sample-reading', digest: 'sample', title: 'A few things to read', outcome: 'Keep a short reading list for a quieter moment.', timing: 'Every weekend', timezone: 'Asia/Singapore', enabled: false, editable: true },
];
const scheduled = scheduledPane({ description: 'Sample schedules. Changes stay in this preview.', request: async action => {
  const item = schedules.find(item => item.id === action.id);
  if (item && ['pause', 'resume'].includes(action.action)) item.enabled = action.action === 'resume';
  if (item && ['inspect', 'edit'].includes(action.action)) showSample(item.title, item.outcome + ' ' + item.timing + '. This example does not change your real schedules.');
  return { entries: schedules, running: true };
} });
scheduled.update({ entries: schedules, running: true });
document.querySelector('.top-actions').append(scheduled.trigger, inspector.trigger);
document.body.append(scheduled.element, inspector.element);
const progress = composerProgress();
document.querySelector('.composer-wrap').prepend(progress.element);
const completed = {
  id: 'sample-sunday', current: true, title: 'A quieter Sunday', active: false, state: 'completed', started_at: ago(119), finished_at: ago(0),
  steps: [{ id: 'notes', text: 'Read your notes', icon: 'book-open', state: 'completed' }, { id: 'ideas', text: 'Gather a few ideas', icon: 'lightbulb', state: 'completed' }, { id: 'plan', text: 'Put together your plan', icon: 'list-checks', state: 'completed' }],
};
progress.update({ ...completed, active: true, state: 'running', finished_at: undefined, steps: [...completed.steps.slice(0, 2), { ...completed.steps[2], state: 'running' }] });
setInterval(progress.tick, 1000);
const motion = element('section', undefined, 'motion-preview');
const replay = element('button', 'Replay current task', 'quiet'); replay.type = 'button';
motion.append(replay); document.querySelector('.paper').append(motion);
replay.addEventListener('click', () => {
  replay.disabled = true;
  const task = { ...completed, active: true, state: 'running', started_at: new Date().toISOString(), finished_at: undefined, steps: [] };
  progress.update(task);
  for (let index = 0; index < completed.steps.length; index++) {
    setTimeout(() => {
      task.steps = completed.steps.slice(0, index).map(step => ({ ...step }));
      task.steps.push({ ...completed.steps[index], state: 'running' }); progress.update(task);
    }, 600 + index * 1800);
  }
  setTimeout(() => { progress.update({ ...task, steps: completed.steps, state: 'completed', active: false, finished_at: new Date().toISOString() }); replay.disabled = false; }, 6500);
});
export function paletteCommands() {
  return [
    { label: 'Return to chat', action: () => location.assign('/') },
    { label: 'Scheduled tasks', action: scheduled.open },
    { label: 'Delegated work', action: inspector.open },
    { label: 'Replay current task', action: () => replay.click() },
    ...[...document.querySelectorAll('.artifact iframe')].map((frame, index) => ({ label: frame.title + ' ' + (index + 1), group: 'Output', action: () => frame.scrollIntoView({ block: 'center', behavior: 'smooth' }) })),
  ];
}
