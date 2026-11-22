// isolated UI protocol fixture; never calls a model or executes an external action.
const readline = require('node:readline');
if (process.argv.includes('ui-maintenance-lease')) {
  process.stdout.write('{"ready":false}\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));
} else {
  const planID = 'c'.repeat(32), digest = 'd'.repeat(64);
  const plan = { id: planID, revision: 1, digest, task: 'Summarize the reading notes', phase: 'review', state: 'queued', sources: ['Reading notes'], input_names: ['notes.md'], budget: { max_steps: 6, code_max_steps: 0 }, content: { outcome: 'A short reading summary', steps: [{ id: 'read', text: 'Read the selected notes' }, { id: 'summarize', text: 'Write a short summary' }], effects: ['read', 'draft'], sources: ['notes.md'] } };
  const state = { conversation_id: 'review-fixture', source: process.cwd(), title: 'A quiet update · fictional fixture', foreground: false,
    running: true, dialogue_active: true, can_correct_action: true, can_revise_plans: [planID], task_plans: [plan],
    messages: [{ role: 'Hot Cross Buns', text: 'A fictional draft is ready for review.', result: { kind: 'approval', title: 'Review draft update', summary: 'Fictional fixture only. Nothing is sent.', preview: { to: 'reader@example.invalid', subject: 'A little update', body: 'A quiet note for tomorrow.' } } }],
    pending_approval: { id: 1, token: 'a'.repeat(64), message_index: 0 },
    provider: 'fixture', model: 'fixture', composer: { id: 'b'.repeat(64), effort: 'standard', readiness: { state: 'configured' }, models: [] }, queue: [],
  };
  const emit = () => process.stdout.write(JSON.stringify({ version: 1, type: 'state', state }) + '\n'); emit();
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const frame = JSON.parse(line);
    if (frame.type === 'exit') process.exit(0);
    if (frame.type === 'focus_session') state.foreground = frame.foreground;
    if (frame.type === 'task_plan') state.task_plan_result = { request_id: frame.task_plan.request_id, review: plan };
    if (frame.type === 'upload_submit') {
      state.upload_result = { request_id: frame.upload.request_id };
      state.dialogue = [{ id: 'e'.repeat(64), sequence: 1, revision: 1, text: frame.upload.text, response: 'Correction requested. Any replacement still needs review.', state: 'answered', created_at: new Date().toISOString() }];
      state.pending_approval = { ...state.pending_approval, id: 2, token: 'f'.repeat(64) };
      state.messages[0].result.preview.subject = 'Corrected fictional update';
    }
    if (frame.type === 'native_catalog') state.native_catalog_query_result = { request_id: frame.native_catalog.request_id, page: { items: [], next: '' } };
    emit();
    if (frame.nonce) process.stdout.write(JSON.stringify({ version: 1, type: 'action_applied', nonce: frame.nonce }) + '\n');
  });
}
