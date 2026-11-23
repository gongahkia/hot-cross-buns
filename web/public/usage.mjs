import { element } from './text.mjs';
import { brandIcon, providerBrand, providerLabel } from './brands.mjs';

const number = value => new Intl.NumberFormat().format(value || 0);
const short = value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
const dayLabel = day => new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const limit = value => value ? number(value) : 'Uncapped';
function heading(title, note) {
  const head = element('div', undefined, 'usage-section-head');
  head.append(element('h3', title), element('span', note, 'hint')); return head;
}
export function usageView(usage) {
  const root = element('div', undefined, 'usage-dashboard');
  const intro = element('div', undefined, 'usage-intro');
  intro.append(element('p', 'On this computer', 'usage-eyebrow'), element('p', dayLabel(usage.day) + ' · Today, UTC', 'hint'));
  if (usage.paused) intro.append(element('p', 'New provider requests are paused.', 'usage-paused'));
  const metrics = element('div', undefined, 'usage-metrics');
  for (const [label, value, note] of [
    ['Requests', number(usage.requests), usage.daily_request_limit ? 'of ' + number(usage.daily_request_limit) + ' daily' : 'No daily limit'],
    ['Tokens', short(usage.tokens), usage.estimated_requests ? number(usage.estimated_requests) + ' requests estimated' : 'Recorded usage'],
    ['Active', number(usage.active_requests), usage.failed_requests ? number(usage.failed_requests) + ' failed attempts today' : 'No failed attempts today'],
  ]) {
    const metric = element('div', undefined, 'usage-metric'); metric.append(element('span', label), element('strong', value), element('small', note)); metrics.append(metric);
  }
  const trend = element('section', undefined, 'usage-trend');
  const head = heading('Last 7 days', 'UTC');
  const choices = element('div', undefined, 'usage-metric-switch'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'Chart metric');
  const chart = element('div', undefined, 'usage-chart');
  const caption = element('p', undefined, 'hint usage-chart-caption');
  const table = element('table', undefined, 'sr-only'); table.append(element('caption', 'Daily usage, UTC'));
  const tableHead = element('tr'); for (const text of ['Date', 'Requests', 'Tokens']) tableHead.append(element('th', text)); table.append(tableHead);
  for (const day of usage.history || []) { const row = element('tr'); for (const text of [day.day, number(day.requests), number(day.tokens)]) row.append(element('td', text)); table.append(row); }
  const buttons = new Map();
  function draw(metric) {
    chart.replaceChildren(); const days = usage.history || [], max = Math.max(1, ...days.map(day => day[metric]));
    chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `Daily ${metric} for the last seven days. Exact values follow in the daily usage table.`);
    for (const day of days) {
      const column = element('div', undefined, 'usage-day');
      const value = element('span', short(day[metric]), 'usage-day-value');
      const track = element('div', undefined, 'usage-day-track'), bar = element('div', undefined, 'usage-day-bar');
      bar.style.height = 100 * day[metric] / max + '%'; bar.dataset.empty = String(!day[metric]);
      column.title = dayLabel(day.day) + ': ' + number(day[metric]) + ' ' + metric;
      track.append(bar); column.append(value, track, element('span', dayLabel(day.day), 'usage-day-label')); chart.append(column);
    }
    caption.textContent = !days.length || !days.some(day => day[metric]) ? 'No ' + metric + ' recorded in this period.' : metric === 'tokens' ? 'Tokens include estimates until provider usage arrives.' : 'Every provider attempt counts, including retries.';
    for (const [name, button] of buttons) button.setAttribute('aria-pressed', String(name === metric));
  }
  for (const metric of ['requests', 'tokens']) { const button = element('button', metric === 'requests' ? 'Requests' : 'Tokens', 'quiet'); button.type = 'button'; button.addEventListener('click', () => draw(metric)); buttons.set(metric, button); choices.append(button); }
  head.append(choices); trend.append(head, chart, caption, table); draw('requests');
  const providers = element('section', undefined, 'usage-providers'); providers.append(heading('Providers & models', 'Today'));
  const total = Math.max(1, usage.requests);
  for (const provider of usage.providers || []) {
    const [id, ...model] = provider.name.split('/');
    const row = element('div', undefined, 'usage-provider');
    const name = element('div', undefined, 'usage-provider-name');
    const brand = providerBrand(id), label = element('div'); label.append(element('span', providerLabel(id)), element('small', model.join('/') || 'All recorded requests'));
    name.append(brandIcon(brand), label);
    const amount = element('div', undefined, 'usage-provider-amount'); amount.append(element('span', number(provider.requests) + ' requests'), element('small', short(provider.tokens) + ' tokens' + (provider.estimated_requests ? ' · Includes estimates' : '')));
    const track = element('div', undefined, 'usage-provider-track'), bar = element('div'); bar.style.width = Math.min(100, provider.requests / total * 100) + '%'; track.append(bar);
    row.append(name, amount, track); providers.append(row);
  }
  if (!usage.providers?.length) providers.append(element('p', 'Provider usage will appear here after your first request.', 'hint'));
  const categories = element('section', undefined, 'usage-categories'); categories.append(heading('Where requests went', 'Today'));
  for (const category of (usage.categories || []).filter(category => category.requests)) {
    const row = element('div', undefined, 'usage-category');
    const label = category.name.charAt(0).toUpperCase() + category.name.slice(1);
    const track = element('div', undefined, 'usage-category-track'), bar = element('div'); bar.style.width = Math.min(100, category.requests / total * 100) + '%'; track.append(bar);
    row.append(element('span', label), track, element('span', number(category.requests))); categories.append(row);
  }
  if (!(usage.categories || []).some(category => category.requests)) categories.append(element('p', 'Nothing recorded yet.', 'hint'));
  const note = element('p', usage.known_cost_usd == null ? 'Cost is unavailable when pricing or usage is missing. Local CLI agent usage is billed separately.' : 'Recorded cost: ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(usage.known_cost_usd) + '. Local CLI agent usage is billed separately.', 'hint usage-note');
  root.append(intro, metrics, trend, providers, categories, note);
  return root;
}
export function usageLimits(usage) {
  const list = element('dl', undefined, 'view-facts');
  for (const [name, value] of [['Requests per day', limit(usage.daily_request_limit)], ['Tokens per day', limit(usage.daily_token_limit)], ['Concurrent requests', limit(usage.concurrent_limit)]]) list.append(element('dt', name), element('dd', value));
  return list;
}
