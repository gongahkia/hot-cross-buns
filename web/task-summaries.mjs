import brands from "../internal/branding/catalog.json" with { type: "json" };

// Read only the public projections of already-owned sessions. Inspection never
// starts a replacement owner or exposes tool arguments, output, or reasoning.
export function taskSummaries(host) {
  const visible = new Set(host.sessions.activity().map(item => item.id));
  const tasks = [];
  for (const owner of host.sessions.workers) {
    const state = owner.state;
    if (!state?.conversation_id || owner !== host.backend && !visible.has(state.conversation_id)) continue;
    const retained = state.messages?.findLast(message => message.activity);
    const plans = state.task_plans || [];
    const active = !owner.closed && !!(state.running || state.dialogue_busy || state.pending_operation || plans.some(plan => ['preparing', 'revising'].includes(plan.phase)));
    const waiting = !!state.pending_approval || plans.some(plan => ['review', 'approved'].includes(plan.phase));
    const trace = state.activity || (!active && !waiting && !state.queued ? retained?.activity : undefined);
    if (!active && !trace && !waiting && !state.queued) continue;
    const status = owner.closed ? 'disconnected' : state.cancelling ? 'stopping' : waiting ? 'waiting' : active ? 'running' : state.queued ? 'queued' : trace?.state || 'idle';
    tasks.push({
      id: state.conversation_id, title: String(state.title || 'Your request').slice(0, 180),
      current: owner === host.backend, state: status, active: !owner.closed && (active || waiting),
      canOpen: owner === host.backend || host.sessions.canOpen(state.conversation_id),
      parent: state.dialogue_task?.parent_id && (state.dialogue_task.parent_id === host.backend?.state?.conversation_id || host.sessions.canOpen(state.dialogue_task.parent_id)) ? state.dialogue_task.parent_id : undefined,
      summary: !active && !waiting && !state.queued ? String(state.dialogue_task?.summary || retained?.text || '').slice(0, 700) : '',
      started_at: trace?.started_at, finished_at: trace?.finished_at,
      steps: (trace?.entries || []).filter(entry => entry.kind === 'tool' || entry.kind === 'status').map(entry => ({
        id: entry.id, tool: entry.tool, icon: entry.icon, brand: entry.brand, text: entry.kind === 'status' ? entry.text : undefined,
        state: entry.state, started_at: entry.started_at, finished_at: entry.finished_at,
      })),
      truncated: !!trace?.truncated,
      plans: plans.slice(-4).map(plan => ({ id: plan.id, task: plan.task, phase: plan.phase, steps: (plan.steps || []).map(step => step.text) })),
    });
  }
  return tasks.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.current) - Number(a.current) || String(b.finished_at || b.started_at || '').localeCompare(String(a.finished_at || a.started_at || ''))).slice(0, 32);
}

export function delegatedSummaries(host) {
  const names = { cli_codex: 'Codex', cli_claude: 'Claude Code', cli_pi: 'Pi', cli_opencode: 'OpenCode', cli_gemini: 'Gemini CLI', cli_copilot: 'GitHub Copilot' };
  const statuses = { queued: 'queued', running: 'running', answering: 'running', awaiting_input: 'waiting', completed: 'completed', failed: 'failed', cancelled: 'stopped', stopped: 'stopped' };
  const result = [];
  for (const owner of host.sessions.workers) {
    const state = owner.state;
    if (!state?.conversation_id || owner !== host.backend && !host.sessions.canOpen(state.conversation_id)) continue;
    for (const card of state.specialists || []) {
      const status = owner.closed ? 'disconnected' : statuses[card.status] || 'idle';
      result.push({ id: state.conversation_id + ':' + card.id, conversation: state.conversation_id,
        title: String(card.assignment || card.description || card.name).slice(0, 180),
        engine: names[card.name] || 'Hot Cross Buns', brand: brands.find(brand => brand.specialists.includes(card.name))?.id || '', assignment: card.assignment || card.description,
        state: status, active: !owner.closed && ['running', 'waiting', 'queued'].includes(status), current: false,
        canOpen: owner === host.backend || host.sessions.canOpen(state.conversation_id), steps: [],
      });
    }
  }
  return result.slice(0, 64);
}
