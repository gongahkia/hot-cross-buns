import { element } from './text.mjs';
import { memoryPane } from './memory.mjs';
import { createMemorySamples } from './memory-samples.mjs';

const samples = createMemorySamples();
const dialog = document.getElementById('detail');
const status = element('p', undefined, 'hint'); status.setAttribute('role', 'status');
const pane = memoryPane({
  request: samples.request,
  description: 'Sample memories for a fictional user. Try editing or forgetting an item. Reset samples or reload to start again. Your saved memories stay untouched.',
  manage: route => {
    status.textContent = route === '/memory'
      ? 'Preview only. In your profile, Memory settings opens the existing recall and privacy controls.'
      : route === '/goals'
        ? 'Preview only. Goal context is managed within its goal, with its own scope and review controls.'
        : 'Preview only. Guidance is managed through its existing review, activation, and rejection controls.';
  },
});
pane.element.querySelector('.memory-tools').append(control('Reset samples', reset));
pane.element.querySelector('.memory-tools').after(status);
document.getElementById('detail-title').textContent = 'Memory · Preview';
document.getElementById('detail-body').replaceChildren(pane.element);
dialog.classList.add('memory-pane');
document.getElementById('close-detail').addEventListener('click', () => dialog.close());
document.getElementById('title').textContent = 'Memory preview';
document.title = 'Memory preview · Hot Cross Buns';
document.getElementById('transcript').replaceChildren(
  element('p', 'Explore every memory section with sample data. All changes stay in this preview and reset when the page reloads.', 'hint'),
  control('Open Memory preview', open),
);
document.getElementById('composer').hidden = true;
document.getElementById('history').remove();
const brand = document.getElementById('history-toggle');
brand.removeAttribute('aria-controls'); brand.removeAttribute('aria-expanded');
brand.addEventListener('click', () => location.assign('/'));
function control(text, action) {
  const button = element('button', text, 'quiet'); button.type = 'button'; button.addEventListener('click', action); return button;
}
async function reset() { samples.reset(); status.textContent = 'Sample memories restored.'; await pane.load(); }
function open() { if (!dialog.open) dialog.showModal(); }
export function paletteCommands() {
  return [
    { label: 'Open Memory preview', action: open },
    { label: 'Reset sample memories', action: () => void reset() },
    { label: 'Back to chat', action: () => location.assign('/') },
    { label: 'Output preview', action: () => location.assign('/?preview=outputs') },
  ];
}
await pane.load();
open();
