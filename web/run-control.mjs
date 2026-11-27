// Only control a live owner already in this conversation's execution family.
export function activeRunControl(host) {
  const current = host.backend;
  if (!current || current.closed) return null;
  if (current.state?.stop_id) return { owner: current, id: current.state.stop_id };
  if (!current.state?.primary) return null;
  const children = [...host.sessions.workers].filter(owner => !owner.closed &&
    owner.state?.running && owner.state?.dialogue_task?.parent_id === current.state.conversation_id);
  return children.length === 1 && children[0].state.stop_id ? { owner: children[0], id: children[0].state.stop_id } : null;
}
