import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { Button } from '../../components/primitives';
import { syncProgressEvent, type SyncProgressDetail } from './syncProgress';

export function SyncProgressOverlay() {
  const [operations, setOperations] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<SyncProgressDetail>).detail;
      setOperations(current => { const next = new Set(current); if (detail.phase === 'start') next.add(detail.id); else next.delete(detail.id); return next; });
      setError(detail.error);
    };
    window.addEventListener(syncProgressEvent, update);
    return () => window.removeEventListener(syncProgressEvent, update);
  }, []);
  const busy = operations.size > 0;
  return <Dialog.Root open={busy || Boolean(error)} onOpenChange={open => { if (!open && !busy) setError(undefined); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[min(340px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-primary p-6 text-center text-text-primary shadow-2xl outline-none" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        {busy ? <LoadingIndicator size={140} /> : null}
        <Dialog.Title className="text-lg font-semibold">{busy ? 'Resyncing with Google' : 'Resync needs attention'}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-text-muted" role={error ? 'alert' : 'status'}>{busy ? 'Refreshing your tasks and calendars. This may take a moment.' : error}</Dialog.Description>
        {!busy ? <Button className="mt-4" onClick={() => setError(undefined)}>Close</Button> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
