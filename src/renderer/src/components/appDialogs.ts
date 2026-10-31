export type AppDialogOptions = { title?: string; confirmLabel?: string; destructive?: boolean };
export type AppDialogRequest = AppDialogOptions & { id: number; message: string; alert: boolean; trigger: HTMLElement | null; resolve: (accepted: boolean) => void };
let nextId = 0;
let requests: AppDialogRequest[] = [];
const listeners = new Set<() => void>();
function notify() { listeners.forEach(listener => listener()); }
export const subscribeAppDialogs = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const currentAppDialog = () => requests[0] ?? null;
function requestDialog(message: string, options: AppDialogOptions, alert: boolean): Promise<boolean> {
  return new Promise(resolve => {
    requests = [...requests, { ...options, id: ++nextId, message, alert, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null, resolve }];
    notify();
  });
}
export const confirmInApp = (message: string, options: AppDialogOptions = {}) => requestDialog(message, options, false);
export async function alertInApp(message: string, options: AppDialogOptions = {}): Promise<void> { await requestDialog(message, options, true); }
export function settleAppDialog(id: number, accepted: boolean): void {
  const request = requests.find(item => item.id === id);
  if (!request) return;
  requests = requests.filter(item => item.id !== id);
  notify();
  request.resolve(accepted);
}
export function cancelAppDialogs(): void {
  const pending = requests;
  requests = [];
  notify();
  pending.forEach(request => request.resolve(false));
}
