export function transcriptItems(messages, talks, updates) {
  const time = value => Math.max(0, Date.parse(value) || 0);
  let lastMessageTime = 0;
  const orderedMessages = messages.map(value => {
    // The retained welcome is appended to preserve backend approval indexes.
    if (value.introduction) return { type: 'message', value, at: time(value.created_at) };
    lastMessageTime = Math.max(lastMessageTime, time(value.created_at), time(value.activity?.started_at));
    return { type: 'message', value, at: lastMessageTime };
  });
  return [
    ...orderedMessages,
    ...talks.map(value => ({ type: 'talk', value, at: time(value.created_at) })),
    ...updates.map(value => ({ type: 'update', value, at: time(value.created_at) })),
  ].sort((a, b) => a.at - b.at);
}
