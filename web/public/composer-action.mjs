export function composerAction(snapshot, { text = '', files = [], pending = false, correction = false } = {}) {
  const state = snapshot.state || {};
  const active = state.running || state.working || snapshot.control?.stop || snapshot.tasks?.some(task => task.active);
  if (!pending && !correction && !text.trim() && !files.length && active) {
    return { action: 'stop', icon: 'square', label: state.cancelling ? 'Stopping task' : 'Stop task', disabled: !snapshot.control?.stop || !!state.cancelling };
  }
  return { action: 'send', icon: 'send', label: pending ? 'Retry message' : active && !correction && !files.length ? 'Steer task' : 'Send message', disabled: false };
}
