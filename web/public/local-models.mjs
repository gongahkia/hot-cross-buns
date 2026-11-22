import { element } from './text.mjs';

export function localModelsView({ request }) {
  const root = element('section', undefined, 'local-models-view');
  const notice = element('p', undefined, 'issue'); notice.setAttribute('role', 'alert'); notice.hidden = true;
  const body = element('div'); root.append(notice, body);
  let status, review, receipt, busy = false;
  function button(label, run) { const node = element('button', label, 'quiet'); node.type = 'button'; node.addEventListener('click', () => void run()); return node; }
  async function perform(action) {
    if (busy) return;
    busy = true; notice.hidden = true; root.setAttribute('aria-busy', 'true');
    for (const control of root.querySelectorAll('button')) control.disabled = true;
    try {
      const result = await request(action);
      if (result.local) status = result.local;
      if (result.local_review) review = result.local_review;
      if (result.local_receipt) receipt = result.local_receipt;
      if (result.error) { notice.textContent = result.error; notice.hidden = false; }
      else if (['local_select', 'local_cancel_review'].includes(action.action)) review = undefined;
      if (action.action === 'local_select' && result.confirmed && result.changed) {
        const fresh = await request({ action: 'local_status' });
        if (fresh.local) status = fresh.local;
        if (fresh.error) { notice.textContent = fresh.error; notice.hidden = false; }
      }
    } catch (error) { notice.textContent = error.message; notice.hidden = false; }
    finally {
      if (action.action === 'local_select') review = undefined;
      busy = false; root.removeAttribute('aria-busy'); render();
    }
  }
  function render() {
    body.replaceChildren(element('p', 'Inspect Ollama and choose an installed model for future requests. Opening this view does not start inference.', 'hint'));
    body.append(button('Refresh status', () => perform({ action: 'local_status' })));
    if (!status) { body.append(element('p', 'No local runtime observation is available yet.', 'hint')); return; }
    const facts = element('dl', undefined, 'view-facts');
    for (const [label, value] of [['Runtime', status.reachable ? 'Reachable' : 'Not available'], ['Future model', status.selected_model || 'None selected'], ['Installed inventory', status.installed_known ? String(status.installed?.length || 0) + ' models' : 'Not verified']]) facts.append(element('dt', label), element('dd', value));
    body.append(facts);
    if (status.issue || status.selection_block) body.append(element('p', status.issue || status.selection_block, 'hint'));
    if (!status.reachable) body.append(element('p', 'Install and start Ollama separately, then refresh. Runtime installation, start/stop, and model downloads are not available here yet.', 'hint'));
    if (receipt) {
      const summary = element('section', undefined, 'view-section');
      summary.append(element('h3', 'Last selection'), element('p', receipt.tag + ' · ' + receipt.phase));
      summary.append(button('Reconcile selection', () => perform({ action: 'local_reconcile', operation_id: receipt.id })));
      body.append(summary);
    }
    if (review) {
      const section = element('section', undefined, 'view-section local-selection-review'); section.setAttribute('aria-label', 'Review future model selection');
      section.append(element('h3', 'Review future model selection'));
      const facts = element('dl', undefined, 'view-facts');
      for (const [label, value] of [['Model', review.tag], ['Installed digest', review.digest], ['Endpoint', review.endpoint]]) facts.append(element('dt', label), element('dd', value));
      section.append(facts, element('p', review.notice, 'hint'),
        button('Cancel', () => perform({ action: 'local_cancel_review', review_id: review.id, generation: review.generation })),
        button('Confirm future selection', () => perform({ action: 'local_select', review_id: review.id, generation: review.generation, model_id: review.model_id })));
      body.append(section);
    }
    body.append(element('h3', 'Local model catalog'));
    for (const model of status.catalog || []) {
      const row = element('section', undefined, 'view-section local-model-row');
      row.append(element('strong', model.name), element('p', model.tag, 'hint'));
      row.append(element('p', model.downloaded === true ? 'Downloaded' : model.downloaded === false ? 'Not downloaded' : 'Download status unknown', 'hint'));
      if (model.reason) row.append(element('p', model.reason, 'hint'));
      const choose = button('Review selection', () => perform({ action: 'local_review_select', model_id: model.id }));
      choose.disabled = !!review || !!status.selection_block || !status.reachable || !model.eligible || model.downloaded !== true || !/^(sha256:)?[a-f0-9]{64}$/i.test(model.digest) || ['prepared', 'uncertain'].includes(receipt?.phase);
      row.append(choose); body.append(row);
    }
  }
  render();
  return { element: root, load: () => perform({ action: 'local_status' }) };
}
