import { element } from './text.mjs';

export function currentPlan(state = {}) {
  const phases = ['preparing','revising','review','approved','dispatching'];
  const local = state.plans?.find(plan => ['queued','running'].includes(plan.state) && phases.includes(plan.phase));
  if (local) return {plan:local};
  const peer = state.peers?.find(peer => phases.includes(peer.plan_phase));
  return peer ? {conversation:peer.conversation_id} : null;
}

export function planQuestions(questions, submit) {
  const form = element('form', undefined, 'plan-questions');
  form.append(element('h3', 'A few decisions before I start'), element('p', 'Choose an answer or write your own. I’ll revise the plan for your review.', 'hint'));
  const fields = questions.map((question, index) => {
    const group = element('fieldset'); group.append(element('legend', question.question));
    const options = [];
    for (const [at, text] of (question.options || []).entries()) {
      const label = element('label', undefined, 'question-option'), input = element('input'); input.type = 'radio'; input.name = 'plan-question-' + index; input.value = text;
      input.id = 'plan-question-' + index + '-' + at; label.append(input, element('span', text)); group.append(label); options.push(input);
    }
    const customLabel = element('label', question.options?.length ? 'Your own answer' : 'Your answer'), custom = element('textarea'); custom.rows = 2; custom.maxLength = 2048; custom.required = !options.length; customLabel.append(custom); group.append(customLabel);
    custom.addEventListener('input', () => { if (custom.value.trim()) for (const option of options) option.checked = false; custom.setCustomValidity(''); });
    for (const option of options) option.addEventListener('change', () => { custom.value = ''; custom.setCustomValidity(''); });
    form.append(group); return {question, options, custom};
  });
  const send = element('button', 'Continue with answers', 'send'); send.type = 'submit'; form.append(send);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const answers = [];
    for (const field of fields) {
      const answer = field.custom.value.trim() || field.options.find(option => option.checked)?.value;
      if (!answer) { field.custom.setCustomValidity('Choose an option or write an answer.'); field.custom.reportValidity(); return; }
      answers.push({id:field.question.id,question:field.question.question,answer});
    }
    submit('Answers to the pending plan questions (user decisions, not approval):\n' + JSON.stringify(answers) + '\nUpdate this same plan using these answers and return it for review. Do not start implementation.');
  });
  return form;
}

export function correctionText(text = '') {
  const match = /^Regarding (the pending action|plan task [a-f0-9]{32} revision \d+) in conversation [a-zA-Z0-9_-]+:\n([\s\S]*)\nThis is a correction request for review, not approval or permission to start or send anything\.$/.exec(text);
  return match ? { label: match[1] === 'the pending action' ? 'Requested an action correction' : 'Requested a plan revision', text: match[2] } : null;
}

export function planReview(review) {
  const root = element('section', undefined, 'plan-review');
  function field(label, value) {
    if (value === undefined || value === null || value === '') return;
    const section = element('section'); section.append(element('h3', label), element('p', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); root.append(section);
  }
  function list(label, values, empty) {
    const section = element('section'); section.append(element('h3', label));
    if (values?.length) { const list = element('ol'); for (const value of values) list.append(element('li', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); section.append(list); }
    else section.append(element('p', empty || 'None', 'hint')); root.append(section);
  }
  field('Task', review.task); field('Proposed outcome', review.content?.outcome);
  if (review.content?.questions?.length) list('Open questions', review.content.questions.map(item => item.question));
  list('Proposed steps', review.content?.steps?.map(step => step.text), 'No steps supplied.');
  root.append(element('p', 'These are proposed steps. Completion comes from retained results, not this list.', 'hint'));
  list('Declared effects', review.content?.effects, 'No declared effects supplied.');
  list('Selected connections & sources', review.sources);
  list('Sources used by this proposal', review.content?.sources);
  list('Retained inputs', review.input_names);
  if (review.input_additions?.length) list('Inputs added', review.input_additions);
  if (review.input_removals?.length) list('Inputs removed', review.input_removals);
  if (review.access_changes?.length) list('Access changes', review.access_changes);
  const budget = (name, value) => { if (value) field(name, `Work steps: ${value.max_steps ?? 'Not reported'} · Code steps: ${value.code_max_steps ?? 'Not reported'}`); };
  budget(review.attempts?.length ? 'Remaining execution budget' : 'Execution budget', review.budget); budget('Original budget', review.original_budget);
  for (const [i, attempt] of (review.attempts || []).entries()) field(`Prior attempt ${i + 1} · ${attempt.uncertain ? 'effects uncertain' : 'recorded usage'}`, attempt);
  const state = review.phase === 'review' ? 'Proposed · awaiting your review' : review.phase === 'approved' ? 'Reviewed · waiting to start' : ({ preparing: 'Preparing a proposal', revising: 'Preparing a revised proposal', dispatching: 'Dispatched · inspect the recorded result', interrupted: 'Interrupted · not resumed' }[review.phase] || review.state || 'Not reported');
  field('Current state', state); field('Revision', String(review.revision ?? 'Not reported'));
  field('Requested correction', review.correction); field('Issue', review.issue);
  const raw = element('details', undefined, 'task-evidence'); raw.append(element('summary', 'Exact review data'), element('pre', JSON.stringify(review, null, 2))); root.append(raw);
  return root;
}

export function filesystemApprovalActions(choose) {
 const root=element('div',undefined,'review-actions');
 for(const [label,approved,choice] of [['Decline',false],['Allow once',true,'once'],['Always for this folder',true,'always'],['Full filesystem access',true,'full']]) {
  const button=element('button',label);button.type='button';button.addEventListener('click',()=>choose(approved,choice));root.append(button);
 }
 return root;
}

export function schedulingApprovalActions(choose) {
 const root=element('div',undefined,'review-actions');
 for(const [label,approved,choice] of [['Decline',false],['Allow once',true,'once'],['Always allow scheduling',true,'always']]) {
  const button=element('button',label);button.type='button';button.addEventListener('click',()=>choose(approved,choice));root.append(button);
 }
 return root;
}
