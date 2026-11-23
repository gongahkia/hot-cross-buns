import { brandIcon } from './brands.mjs';
import { element } from './text.mjs';
import { icon } from './icons.mjs';

export function localModelsView({ request }) {
  const root = element('section', undefined, 'local-models-view');
  const notice = element('p', undefined, 'issue'); notice.setAttribute('role', 'alert'); notice.hidden = true;
  const body = element('div'); root.append(notice, body);
  let status, review, receipt, runtime, runtimeReview, busy = false, appOwned = true, timer;
  function button(label, run, symbol) {
    const node = element('button', undefined, 'quiet'); node.type = 'button';
    if (symbol) node.append(icon(symbol)); node.append(document.createTextNode(label));
    node.addEventListener('click', () => void run()); return node;
  }
  const localAction = action => ({ ...action, app_owned: appOwned });
  function observe(result) {
    if (result.local) status = result.local;
    if (result.local_review) review = result.local_review;
    if (result.local_receipt) receipt = result.local_receipt;
    if (result.runtime) runtime = result.runtime;
    if (result.runtime_review) runtimeReview = result.runtime_review;
    if (result.error) { notice.textContent = result.error; notice.hidden = false; }
  }
  function schedule() {
    clearTimeout(timer);
    if (!runtime || !['running', 'starting', 'stopping'].includes(runtime.state)) return;
    timer = setTimeout(async () => {
      if (!root.isConnected) return;
      if (busy) { schedule(); return; }
      await perform({ action: 'runtime_status' }, true);
    }, 1500);
    timer.unref?.();
  }
  async function perform(action, polling = false) {
    if (busy) return;
    busy = true;
    if (!polling) notice.hidden = true;
    root.setAttribute('aria-busy', 'true');
    if (!polling) for (const control of root.querySelectorAll('button')) control.disabled = true;
    const previous = JSON.stringify(runtime), oldState = runtime?.state, oldPhase = runtime?.receipt?.phase;
    try {
      observe(await request(action));
      if (['local_select', 'local_cancel_review'].includes(action.action)) review = undefined;
      if (['runtime_start', 'runtime_stop', 'runtime_download', 'runtime_cancel_review'].includes(action.action)) runtimeReview = undefined;
      if (action.action === 'local_select' || action.action === 'runtime_status' && (oldState !== runtime?.state || oldPhase !== runtime?.receipt?.phase)) {
        observe(await request(localAction({ action: 'local_status' })));
      }
    } catch (error) { notice.textContent = error.message; notice.hidden = false; }
    finally {
      if (action.action === 'local_select') review = undefined;
      if (['runtime_start', 'runtime_stop', 'runtime_download'].includes(action.action)) runtimeReview = undefined;
      busy = false; root.removeAttribute('aria-busy');
      if (!polling || previous !== JSON.stringify(runtime)) render();
      schedule();
    }
  }
  function renderRuntime() {
    const section = element('section', undefined, 'view-section local-runtime'); section.setAttribute('aria-label', 'App-owned runtime');
    const heading = element('h3', 'App-owned runtime'); heading.prepend(brandIcon('ollama')); section.append(heading);
    if (!runtime) { section.append(element('p', 'Refresh to inspect the installed runtime.', 'hint')); return section; }
    const labels = { running: 'Running', stopped: 'Stopped', starting: 'Starting…', stopping: 'Stopping…', uncertain: 'Needs attention' };
    const line = element('p', labels[runtime.state] || 'Not verified', 'hint'); line.setAttribute('role', 'status');
    if (runtime.active) line.append(document.createTextNode(' · ' + runtime.active + ' active request' + (runtime.active === 1 ? '' : 's')));
    section.append(line);
    if (runtime.issue) section.append(element('p', runtime.issue, 'hint'));
    if (!runtime.available) section.append(element('p', 'Install Ollama, then refresh. Nothing is installed automatically.', 'hint'));
    const changing = ['starting', 'stopping'].includes(runtime.state) || ['prepared', 'working'].includes(runtime.receipt?.phase);
    const controls = element('div', undefined, 'local-runtime-controls');
    if (runtime.state === 'stopped' || runtime.state === 'running') {
      const start = runtime.state === 'stopped';
      const control = button(start ? 'Start' : 'Stop', () => perform({ action: start ? 'runtime_review_start' : 'runtime_review_stop' }), 'power');
      control.disabled = changing || !!runtime.active || !!runtimeReview || !!review || !runtime.available && start;
      controls.append(control);
    }
    section.append(controls);
    if (runtime.receipt) {
      const operation = runtime.receipt, info = element('p', undefined, 'hint runtime-progress');
      info.setAttribute('role', 'status');
      const name = { runtime_start: 'Start', runtime_stop: 'Stop', runtime_download: 'Download' }[operation.action] || 'Operation';
      const percent = operation.total > 0 ? ' · ' + Math.min(100, Math.round(operation.completed / operation.total * 100)) + '%' : '';
      info.textContent = name + (operation.tag ? ' · ' + operation.tag : '') + ' · ' + operation.phase + percent;
      section.append(info);
      if (operation.progress && operation.phase === 'working') section.append(element('p', operation.progress, 'hint'));
      if (operation.issue) section.append(element('p', operation.issue, 'hint'));
      if (operation.action === 'runtime_download' && operation.phase === 'working') section.append(button('Cancel download', () => perform({ action: 'runtime_cancel_download', review_id: operation.id, generation: runtime.generation })));
    }
    if (runtimeReview) {
      const value = runtimeReview, panel = element('section', undefined, 'view-section local-runtime-review');
      panel.setAttribute('aria-label', 'Review runtime operation');
      panel.append(element('h3', 'Review ' + value.action.replace('runtime_', '')));
      const facts = element('dl', undefined, 'view-facts');
      for (const [label, text] of [['Executable', value.binary], ['Model', value.tag], ['Download', value.size], ['Model storage', value.storage]]) if (text) facts.append(element('dt', label), element('dd', text));
      panel.append(facts, element('p', value.notice, 'hint'),
        button('Cancel', () => perform({ action: 'runtime_cancel_review', review_id: value.id, generation: value.generation })),
        button('Confirm ' + value.action.replace('runtime_', ''), () => perform({ action: value.action, review_id: value.id, generation: value.generation, ...(value.model_id ? { model_id: value.model_id } : {}) })));
      section.append(panel);
    }
    const details = element('details'), facts = element('dl', undefined, 'view-facts');
    details.append(element('summary', 'Runtime details'));
    for (const [label, value] of [['Executable', runtime.binary], ['Model storage', runtime.storage], ['Private endpoint', runtime.endpoint]]) if (value) facts.append(element('dt', label), element('dd', value));
    details.append(facts); section.append(details);
    return section;
  }
  function render() {
    const runtimeDetailsOpen = body.querySelector('.local-runtime details')?.open;
    body.replaceChildren(element('p', 'Manage local models for future requests. Opening this view does not start a model.', 'hint'));
    body.append(button('Refresh status', () => perform(localAction({ action: 'local_status' })), 'refresh-cw'), renderRuntime());
    const sources = element('div', undefined, 'local-runtime-controls'); sources.setAttribute('aria-label', 'Model source');
    for (const [owned, label] of [[true, 'App-owned'], [false, 'Configured runtime']]) {
      const control = button(label, async () => {
        appOwned = owned; status = undefined; review = undefined;
        await perform(localAction({ action: 'local_status' }));
      });
      control.setAttribute('aria-pressed', String(owned === appOwned)); control.disabled = !!review || !!runtimeReview;
      sources.append(control);
    }
    body.append(sources);
    if (runtimeDetailsOpen) body.querySelector('.local-runtime details').open = true;
    if (!status) { body.append(element('p', 'No model inventory observation is available yet.', 'hint')); return; }
    const facts = element('dl', undefined, 'view-facts');
    for (const [label, value] of [['Runtime', status.reachable && (!appOwned || runtime?.state === 'running') ? 'Reachable' : 'Not available'], ['Future model', status.selected_model || 'None selected'], ['Installed inventory', status.installed_known ? String(status.installed?.length || 0) + (status.installed?.length === 1 ? ' model' : ' models') : 'Not verified']]) facts.append(element('dt', label), element('dd', value));
    body.append(facts);
    if (status.issue || status.selection_block) body.append(element('p', status.issue || status.selection_block, 'hint'));
    if (!appOwned) body.append(element('p', 'This source uses your configured endpoint. Other runtime processes and model stores are read-only here.', 'hint'));
    if (receipt) {
      const summary = element('details', undefined, 'view-section');
      summary.append(element('summary', 'Last selection · ' + receipt.phase), element('p', receipt.tag));
      summary.append(button('Reconcile selection', () => perform(localAction({ action: 'local_reconcile', operation_id: receipt.id })))); body.append(summary);
    }
    if (review) {
      const section = element('section', undefined, 'view-section local-selection-review'); section.setAttribute('aria-label', 'Review future model selection');
      section.append(element('h3', 'Review future model selection'));
      const facts = element('dl', undefined, 'view-facts');
      for (const [label, value] of [['Model', review.tag], ['Installed digest', review.digest], ['Endpoint', review.endpoint]]) facts.append(element('dt', label), element('dd', value));
      section.append(facts, element('p', review.notice, 'hint'),
        button('Cancel', () => perform(localAction({ action: 'local_cancel_review', review_id: review.id, generation: review.generation }))),
        button('Confirm future selection', () => perform(localAction({ action: 'local_select', review_id: review.id, generation: review.generation, model_id: review.model_id })))); body.append(section);
    }
    if (status.catalog?.length) body.append(element('h3', 'Local model catalog'));
    for (const model of status.catalog || []) {
      const row = element('section', undefined, 'view-section local-model-row');
      row.append(element('strong', model.name), element('p', model.tag + (model.package_size ? ' · ' + model.package_size : ''), 'hint'));
      row.append(element('p', model.downloaded === true ? 'Downloaded' : model.downloaded === false ? 'Not downloaded' : 'Download status unknown', 'hint'));
      if (model.reason) row.append(element('p', model.reason, 'hint'));
      const choose = button('Review selection', () => perform(localAction({ action: 'local_review_select', model_id: model.id })));
      choose.disabled = !!review || !!runtimeReview || !!status.selection_block || !status.reachable || appOwned && runtime?.state !== 'running' || !model.eligible || model.downloaded !== true || !/^(sha256:)?[a-f0-9]{64}$/i.test(model.digest) || ['prepared', 'uncertain'].includes(receipt?.phase);
      row.append(choose);
      if (appOwned && model.downloaded === false) {
        const download = button('Download', () => perform({ action: 'runtime_review_download', model_id: model.id }), 'download');
        download.disabled = !model.eligible || runtime?.state !== 'running' || !!runtime?.active || !!runtimeReview || !!review || ['prepared', 'working', 'uncertain'].includes(runtime?.receipt?.phase);
        row.append(download);
      }
      body.append(row);
    }
  }
  render();
  return { element: root, load: () => perform(localAction({ action: 'local_status' })) };
}
