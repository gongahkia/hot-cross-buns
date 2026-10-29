export interface SyncLifecycleEvent {
  type: 'sync-lifecycle';
  visible: boolean;
  reason?: 'foreground' | 'online';
}

/** Lifecycle messages contain no credentials and never replace an editor draft. */
export function observeSyncLifecycle(send: (event: SyncLifecycleEvent) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reason: SyncLifecycleEvent['reason'];
  const visible = () => document.visibilityState !== 'hidden';
  const cancel = () => { clearTimeout(timer); timer = undefined; reason = undefined; };
  const schedule = (next: 'foreground' | 'online') => {
    if (next === 'foreground' && !visible()) return;
    if (next === 'online' || !reason) reason = next;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const pending = reason;
      cancel();
      send({ type: 'sync-lifecycle', visible: visible(), reason: pending });
    }, 250);
  };
  const foreground = () => schedule('foreground');
  const online = () => schedule('online');
  const visibility = () => {
    send({ type: 'sync-lifecycle', visible: visible() });
    if (visible()) foreground(); else cancel();
  };
  const hide = () => { cancel(); send({ type: 'sync-lifecycle', visible: false }); };
  send({ type: 'sync-lifecycle', visible: visible() });
  window.addEventListener('focus', foreground);
  window.addEventListener('pageshow', foreground);
  window.addEventListener('online', online);
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    cancel();
    window.removeEventListener('focus', foreground);
    window.removeEventListener('pageshow', foreground);
    window.removeEventListener('online', online);
    window.removeEventListener('pagehide', hide);
    document.removeEventListener('visibilitychange', visibility);
  };
}
