export function voiceController({ authorize, transcribe, cancelGrant, capture, draft, append, submit, speak, stopSpeaking, changed }) {
  let generation = 0, recording, grant, abort, context, baseline = 0, live = false, phase = 'idle', issue = '';
  const emit = () => changed({ phase, live, issue });
  const cancel = (message = '') => {
    generation++; recording?.cancel(); recording = undefined; abort?.abort(); abort = undefined;
    if (grant) void cancelGrant(grant, context).catch(() => {}); grant = undefined;
    stopSpeaking(); live = false; phase = 'idle'; issue = message; emit();
  };
  async function listen(route, continuous = false) {
    if (phase !== 'idle') return;
    const initial = draft();
    if (!initial.allowed) throw new Error('Return to an editable chat before recording.');
    if (continuous && (initial.text.trim() || initial.files || initial.quoted || initial.correction || initial.running)) throw new Error('Send or clear the current draft and finish active work before starting a voice conversation.');
    context = initial.context; live = continuous; issue = ''; phase = 'starting'; const version = ++generation; emit();
    let acquired;
    try {
      acquired = await authorize(route, context);
      if (version !== generation) { await cancelGrant(acquired.grant, initial.context); return; }
      grant = acquired.grant;
      const captured = await capture({ silence: continuous });
      if (version !== generation) { captured.audio.catch(() => {}); captured.cancel(); return; }
      recording = captured; phase = 'recording'; emit();
      const audio = await captured.audio;
      if (version !== generation) return;
      recording = undefined; phase = 'transcribing'; abort = new AbortController(); emit();
      const result = await transcribe(grant, audio, abort.signal);
      if (version !== generation) return;
      grant = undefined; abort = undefined;
      const current = draft();
      if (result.context !== context || current.context !== context || !current.allowed || current.text !== initial.text || current.files !== initial.files || current.attachments !== initial.attachments || current.quoted !== initial.quoted || current.correction !== initial.correction) throw new Error('The draft changed while recording. Your draft is kept; record again.');
      if (!result.text?.trim()) throw new Error('No words recognized. Try recording again.');
      await append(result.text, context);
      if (version !== generation) return;
      if (live) {
        baseline = current.messages?.length ?? 0;
        phase = 'sending'; emit(); await submit(context);
        if (version !== generation) return;
        phase = 'waiting'; emit();
      } else { phase = 'idle'; emit(); }
    } catch (error) { if (version === generation) cancel(error.message); }
  }
  return {
    listen, cancel, stop: () => recording?.stop(),
    async update(value, route) {
      if (phase === 'idle') return;
      if (value.context !== context || !value.connected || value.panel || value.external) { cancel('Voice stopped because the chat changed or disconnected.'); return; }
      if (!live || phase !== 'waiting' || value.running || value.working) return;
      if (value.approval || value.plans?.some(plan => plan.state === 'queued' && plan.phase === 'review')) { cancel('Your reply needs review in the chat.'); return; }
      const replies = (value.messages ?? []).slice(baseline).filter(message => message.role === 'Hot Cross Buns' && message.text && message.result?.kind !== 'approval');
      if (!replies.length) return;
      const version = generation;
      phase = 'speaking'; emit();
      try {
        await speak(replies.map(reply => reply.text).join('\n'));
        if (version !== generation) return;
        phase = 'idle'; await listen(route, true);
      } catch (error) { if (version === generation) cancel(error.message); }
    },
    get state() { return { phase, live, issue }; },
  };
}
