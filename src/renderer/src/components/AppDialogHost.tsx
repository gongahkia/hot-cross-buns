import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from './primitives';
import { cancelAppDialogs, currentAppDialog, settleAppDialog, subscribeAppDialogs } from './appDialogs';

/** App-owned confirmations also work from non-React action helpers. */
export function AppDialogHost(): JSX.Element {
  const request = useSyncExternalStore(subscribeAppDialogs, currentAppDialog);
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => () => cancelAppDialogs(), []);
  const finish = (accepted: boolean) => { if (request) settleAppDialog(request.id, accepted); };
  return <Dialog.Root key={request?.id ?? 'closed'} open={Boolean(request)} onOpenChange={open => { if (!open) finish(false); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm" />
      <Dialog.Content role="alertdialog" className="fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100dvh-2rem)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-2xl border border-border bg-bg-primary p-6 text-text-primary shadow-2xl outline-none"
        onOpenAutoFocus={event => { event.preventDefault(); actions.current?.querySelector<HTMLButtonElement>(request?.alert ? "[data-dialog-accept]" : "[data-dialog-cancel]")?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (request?.trigger?.isConnected) request.trigger.focus(); else (document.querySelector<HTMLElement>('[data-testid="inspector-shell"] [aria-label="Item type"]') ?? document.querySelector<HTMLElement>('[data-testid="settings-workspace"]') ?? document.querySelector<HTMLElement>('[data-testid="app-shell"] button'))?.focus(); }}
        onKeyDown={event => event.stopPropagation()}
        onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); finish(false); }}
        onPointerDownOutside={event => event.preventDefault()}>
        <Dialog.Title className="hcb-brand-heading text-2xl">{request?.title ?? (request?.alert ? 'Something went wrong' : 'Confirm action')}</Dialog.Title>
        <Dialog.Description className="whitespace-pre-wrap text-pretty text-sm leading-relaxed text-text-secondary">{request?.message}</Dialog.Description>
        <div ref={actions} className="flex justify-end gap-2 pt-1">
          {!request?.alert ? <Button data-dialog-cancel variant="secondary" onClick={() => finish(false)}>Cancel</Button> : null}
          <Button data-dialog-accept variant={request?.destructive ? 'danger' : 'primary'} onClick={() => finish(true)}>{request?.confirmLabel ?? (request?.alert ? 'Okay' : 'Continue')}</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
