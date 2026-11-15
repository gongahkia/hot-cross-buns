import { useEffect, useRef, useState } from 'react';
import { synchronizeJournal, type SyncAdapter, type SyncBundle, type SyncLink, type SyncProvider, type SyncStatus } from './journalSync';
import { changeSyncBundle, readSyncBundle, subscribeStore } from './todoStore';
import { serializeTodoText, todayString, type TodoDocument } from './todoText';

export function useJournalSync<L extends SyncLink, S extends { text: string }>(provider: SyncProvider, document: TodoDocument | null, canSave: () => boolean, adapter: SyncAdapter<L, S>, interval: number, enabled = true, validate?: (document: TodoDocument) => void, selectAdapter?: (link: L) => SyncAdapter<L, S>) {
  const [bundle, setBundle] = useState<SyncBundle<L> | null>(null);
  const [failure, setFailure] = useState('');
  const [blocked, setBlocked] = useState<'reauth' | 'permission' | null>(null);
  const inputs = useRef({ canSave, adapter, enabled, validate, selectAdapter }); inputs.current = { canSave, adapter, enabled, validate, selectAdapter };
  const active = useRef(false), running = useRef(false), paused = useRef(false), requested = useRef(false);
  const wakeTimer = useRef(0);
  const generation = useRef<string | null>(null);
  const refresh = async () => {
    try { const latest = await readSyncBundle<L>(provider); if (active.current) { if ((latest?.ledger.generation ?? null) !== generation.current) { generation.current = latest?.ledger.generation ?? null; paused.current = false; setFailure(''); } setBundle(latest); } return latest; }
    catch (error) { if (active.current) setFailure(String(error)); return null; }
  };
  const poll = async (force = false) => {
    if (force) requested.current = true;
    if (!navigator.locks || !document || !inputs.current.enabled || paused.current && !requested.current) return;
    if (running.current) return;
    if (!inputs.current.canSave()) {
      if (requested.current) { clearTimeout(wakeTimer.current); wakeTimer.current = window.setTimeout(() => { if (active.current) void execute.current(true); }, 200); }
      return;
    }
    force ||= requested.current; requested.current = false;
    running.current = true; if (force) paused.current = false;
    try {
      const selected = await readSyncBundle<L>(provider);
      if (!selected) { if (active.current) { setBundle(null); setBlocked(null); } return; }
      const unavailable = await inputs.current.adapter.ready(selected.link);
      if (active.current) setBlocked(unavailable);
      if (unavailable) return;
      if (!force && (selected.link.needsReview || selected.ledger.status.kind === 'error')) return;
      const deliver = async (lock: Lock | null) => {
        if (!lock) return;
        const target = await readSyncBundle<L>(provider); if (!target) return;
        const currentAdapter = inputs.current.selectAdapter?.(target.link) ?? inputs.current.adapter;
        const result = await synchronizeJournal({ store: { change: (work, integrate) => changeSyncBundle(provider, work, integrate) }, adapter: currentAdapter,
          target: { id: target.link.id, generation: target.ledger.generation }, canSave: () => inputs.current.enabled && inputs.current.canSave(), today: todayString, online: () => navigator.onLine !== false, validate: document => inputs.current.validate?.(document), force });
        if (active.current) { setFailure(''); if (result) setBlocked(await inputs.current.adapter.ready(result.link)); }
        if (result?.ledger.status.kind === 'saving' && !result.ledger.checkpoint && inputs.current.canSave()) window.setTimeout(() => { if (active.current) void execute.current(); }, 0);
      };
      if (force) await navigator.locks.request('hot-cross-buns-sync-delivery', deliver);
      else await navigator.locks.request('hot-cross-buns-sync-delivery', { ifAvailable: true }, deliver);
    } catch (error) { paused.current = true; if (active.current) setFailure(String(error)); }
    finally { running.current = false; await refresh(); if (requested.current && active.current) { clearTimeout(wakeTimer.current); wakeTimer.current = window.setTimeout(() => { if (active.current) void execute.current(true); }, 0); } }
  };
  const execute = useRef(poll); execute.current = poll;
  useEffect(() => {
    active.current = true;
    if (!document || !navigator.locks) return () => { active.current = false; };
    let soon = 0;
    const schedule = () => { clearTimeout(soon); soon = window.setTimeout(() => { if (globalThis.document.visibilityState === 'visible') void execute.current(); }, 200); };
    const update = () => { void refresh(); };
    const check = () => { if (globalThis.document.visibilityState === 'visible') void execute.current(); };
    const timer = window.setInterval(check, interval);
    const journal = subscribeStore('journal', schedule), sync = subscribeStore('sync', update);
    window.addEventListener('focus', schedule); window.addEventListener('pageshow', schedule); window.addEventListener('online', schedule); window.addEventListener('offline', schedule);
    globalThis.document.addEventListener('visibilitychange', schedule); globalThis.document.addEventListener('focusout', schedule);
    void refresh().then(check);
    return () => { active.current = false; clearTimeout(wakeTimer.current); clearTimeout(soon); clearInterval(timer); journal(); sync(); window.removeEventListener('focus', schedule); window.removeEventListener('pageshow', schedule); window.removeEventListener('online', schedule); window.removeEventListener('offline', schedule); globalThis.document.removeEventListener('visibilitychange', schedule); globalThis.document.removeEventListener('focusout', schedule); };
  }, [!!document, interval, provider]);
  useEffect(() => { if (!document) return; const timer = window.setTimeout(() => { if (globalThis.document.visibilityState === 'visible') void execute.current(); }, 750); return () => clearTimeout(timer); }, [document]);
  useEffect(() => {
    const status = bundle?.ledger.status;
    if (!status || (status.kind !== 'retrying' && status.kind !== 'saving')) return;
    const delay = status.kind === 'retrying' ? Math.max(250, Math.min(72_000, (status.retryAt ?? 0) - Date.now())) : 250;
    const timer = window.setTimeout(() => { if (globalThis.document.visibilityState === 'visible') void execute.current(); }, delay);
    return () => clearTimeout(timer);
  }, [bundle?.ledger.status.kind, bundle?.ledger.status.retryAt, bundle?.ledger.generation]);
  let status: SyncStatus = bundle ? { ...bundle.ledger.status, name: adapter.name(bundle.link) } : { kind: 'unlinked' };
  if (blocked && bundle) status = { ...status, kind: blocked };
  if (failure) status = { ...status, kind: 'error', detail: failure };
  else if (bundle?.link.needsReview) status = { ...status, kind: 'changed' };
  else if (bundle && status.kind === 'saved' && document && serializeTodoText(document) !== bundle.link.baselineText) status = { ...status, kind: 'saving' };
  return { status, record: bundle?.link ?? null, ledger: bundle?.ledger, refresh, poll: (force = false) => execute.current(force) };
}
