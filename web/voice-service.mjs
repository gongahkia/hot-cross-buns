import { randomUUID } from 'node:crypto';
import { MAX_AUDIO_BYTES, runSpeechRequest } from '../app-host/src/voice.mjs';

// Audio grants belong to a backend instance as well as a conversation. They
// expire and are consumed once; switching away invalidates outstanding work.
export function browserVoice(host, { run = runSpeechRequest, now = Date.now } = {}) {
  const grants = new Map();
  let closed = false, download;
  const current = grant => !closed && grant.owner === host.backend && grant.context === host.context && !host.sessions.switching && !host.backend?.closed && !host.backend?.state?.panel && !host.backend?.state?.external;
  const check = context => {
    host.mutable();
    if (closed || context !== host.context || host.sessions.switching || host.backend.state?.panel) throw new Error('Return to the original chat before using voice.');
  };
  const call = (request, signal) => run(host.binary, host.workspace, host.env, request, signal);
  const changed = () => {
    for (const [id, grant] of grants) if (!current(grant) || (!grant.used && grant.expires <= now())) { grant.controller.abort(); grants.delete(id); }
    if (download && !current(download)) download.controller.abort();
  };
  host.on('change', changed);
  return {
    async action(body) {
      check(body.context); changed();
      const { action } = body;
      if (action === 'cancel-download') {
        if (download?.context === body.context) download.controller.abort();
        return {};
      }
      if (action === 'cancel') {
        const grant = grants.get(body.grant);
        if (grant?.context === body.context) { grant.controller.abort(); grants.delete(body.grant); }
        return {};
      }
      const owner = host.backend, context = host.context;
      if (action === 'status') {
        const status = await call({ action: 'status' });
        check(context); if (owner !== host.backend) throw new Error('The voice conversation changed.');
        return status;
      }
      if (action === 'authorize') {
        if (grants.size >= 8) throw new Error('Finish the current recordings before starting another.');
        const status = await call({ action: 'status' });
        check(context); if (owner !== host.backend) throw new Error('The voice conversation changed.');
        if (!status.ready) throw new Error(status.issue || 'Set up a voice provider first.');
        if (typeof body.route !== 'string' || body.route !== status.route) throw new Error('The voice destination changed. Review Voice settings before recording.');
        const id = randomUUID();
        grants.set(id, { context, owner, route: status.route, expires: now() + 150000, controller: new AbortController() });
        return { grant: id, max_seconds: 120, max_audio_bytes: MAX_AUDIO_BYTES };
      }
      if (action === 'configure') {
        const p = body.preferences;
        if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(key => !['provider', 'model', 'language'].includes(key)) || !['whisper-local', 'openai', 'gemini'].includes(p.provider) || typeof p.model !== 'string' || p.model.length > 128 || typeof (p.language ?? '') !== 'string' || (p.language ?? '').length > 32) throw new Error('Choose valid voice settings.');
        // Reconfiguration revokes capture consent even when the chat is unchanged.
        for (const grant of grants.values()) grant.controller.abort(); grants.clear();
        const status = await call({ action: 'configure', preferences: p });
        await owner.refreshPreferences();
        check(context); if (owner !== host.backend) throw new Error('The voice conversation changed.');
        return status;
      }
      if (action === 'download') {
        if (download || !['tiny', 'base', 'small'].includes(body.model)) throw new Error('Finish the current download and choose a listed Whisper model.');
        const operation = { context, owner, controller: new AbortController() }; download = operation;
        try {
          const result = await call({ action: 'download', model: body.model }, operation.controller.signal);
          if (!current(operation)) throw new Error('The voice conversation changed.');
          return result;
        } finally { if (download === operation) download = undefined; }
      }
      throw new Error('This voice action is unavailable.');
    },
    async transcribe(id, bytes, mediaType, disconnected) {
      changed();
      const grant = grants.get(id);
      if (!grant || grant.used || !current(grant)) throw new Error('Start a new recording in this chat.');
      if (!bytes.length || bytes.length > MAX_AUDIO_BYTES || mediaType !== 'audio/wav') throw new Error('Record up to two minutes of PCM WAV audio.');
      grant.used = true;
      const abort = () => grant.controller.abort(); disconnected?.addEventListener('abort', abort, { once: true });
      if (disconnected?.aborted) abort();
      try {
        const result = await call({ action: 'transcribe', route: grant.route, recording: { media_type: mediaType, data: bytes.toString('base64') } }, grant.controller.signal);
        if (!current(grant) || grant.controller.signal.aborted) throw new Error('Dictation cancelled or chat changed. Your draft is kept.');
        if (typeof result.text !== 'string' || Buffer.byteLength(result.text) > 128 * 1024) throw new Error('The transcript is too large. Try a shorter recording.');
        return { context: grant.context, text: result.text };
      } finally { disconnected?.removeEventListener('abort', abort); grants.delete(id); }
    },
    close() { closed = true; changed(); download?.controller.abort(); host.off('change', changed); },
  };
}
