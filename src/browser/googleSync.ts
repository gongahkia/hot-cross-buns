import { CoreStore, CoreStoreError } from '@shared/core/CoreStore';
import { GoogleSyncService } from '@shared/google/GoogleSyncService';
import { SyncPersistenceError, type SyncCheckpoint } from '@shared/google/types';
import { BrowserGoogleSessions } from './googleSyncSessions';
import { beginSyncAttempt, finishSyncAttempt, readSyncSchedule, shouldSyncAutomatically, syncScheduleKey, type AutomaticSyncReason } from './syncSchedule';

type RecordValue = Record<string, any>;
type DispatchResult = { handled: true; value: any } | { handled: false };

/** Google operations are serialized separately; SQL segments own the workspace lease. */
export class BrowserGoogleSync {
  readonly service: GoogleSyncService;
  private selectedAccounts: Set<string> | undefined;
  constructor(
    private readonly store: CoreStore,
    readonly sessions: BrowserGoogleSessions,
    private readonly checkpoint: (checkpoint: SyncCheckpoint) => Promise<void>,
    private readonly outsideWorkspace: <T>(wait: () => Promise<T>) => Promise<T> = wait => wait(),
  ) {
    this.service = new GoogleSyncService(store, {
      onConnectionChange: listener => sessions.onConnectionChange(listener),
      googleFetch: async (accountId, url, init) => {
        const account = store.googleAccount(accountId);
        if (!account || account.connectionState !== 'connected' || !sessions.has(accountId, account.googleAccountId)) {
          throw new CoreStoreError('Reconnect the selected Google account before syncing. Its local data and pending changes are preserved.');
        }
        const response = await this.outsideWorkspace(async () => {
          const response = await sessions.googleFetch(accountId, url, init);
          // Consume the body while unlocked too. Returning just the headers
          // would leave slow/stalled JSON downloads holding the writer again.
          const bytes = response.body ? await response.arrayBuffer() : null;
          return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
        });
        const current = store.googleAccount(accountId);
        if (!current || current.googleAccountId !== account.googleAccountId) throw new CoreStoreError('The Google account changed during this request. Local changes are preserved.');
        // Preserve receipts of writes already accepted before a disconnect.
        // Subsequent requests still check the durable connection state above.
        if ((!init?.method || ['GET', 'HEAD'].includes(init.method.toUpperCase())) && current.connectionState !== 'connected') {
          throw new CoreStoreError('Google was disconnected while downloading. Local changes are preserved.');
        }
        return response;
      },
    }, {
      checkpoint, automaticConnectionSync: false,
      accountAvailable: accountId => this.hasSession(accountId) && (!this.selectedAccounts || this.selectedAccounts.has(accountId)),
      accountSyncFinished: async (accountId, succeeded) => {
        if (!this.selectedAccounts?.has(accountId)) return;
        const now = Date.now();
        store.setGoogleOperationRecord(accountId, syncScheduleKey, finishSyncAttempt(this.schedule(accountId, now), now, succeeded));
        await this.saveSchedule();
      },
      accountCapabilities: accountId => {
        const scopes = sessions.metadata(accountId)?.scopes ?? [];
        return { tasks: scopes.includes('https://www.googleapis.com/auth/tasks'), calendar: scopes.includes('https://www.googleapis.com/auth/calendar') };
      },
      operations: {
        read: (accountId, key) => store.googleOperationRecord(accountId, key),
        write: (accountId, key, value) => store.setGoogleOperationRecord(accountId, key, value),
      },
    });
  }

  private hasSession(accountId: string): boolean {
    const account = this.store.googleAccount(accountId);
    return Boolean(account?.connectionState === 'connected' && this.sessions.has(accountId, account.googleAccountId));
  }

  private schedule(accountId: string, now: number) {
    return readSyncSchedule(this.store.googleOperationRecord(accountId, syncScheduleKey), now);
  }

  private async saveSchedule(): Promise<void> {
    const checkpoint: SyncCheckpoint = { stage: 'sync-status' };
    try { await this.checkpoint(checkpoint); }
    catch (error) { throw error instanceof SyncPersistenceError ? error : new SyncPersistenceError(checkpoint, error); }
  }

  /** Caller owns Google serialization and a workspace lease for selection/claim. */
  async runAutomatic(reason: AutomaticSyncReason, visible: boolean): Promise<RecordValue> {
    const settings = this.store.dispatch('settings', 'get');
    const now = Date.now();
    const accounts = this.store.googleAccounts().filter(account => {
      if (!this.hasSession(account.accountId)) return false;
      const scopes = this.sessions.metadata(account.accountId)?.scopes ?? [];
      const tasks = settings.syncTasksEnabled !== false && scopes.includes('https://www.googleapis.com/auth/tasks');
      const calendar = settings.syncCalendarEventsEnabled !== false && scopes.includes('https://www.googleapis.com/auth/calendar');
      if (!tasks && !calendar) return false;
      const readyWrites = this.store.pendingSyncMutations(100, account.accountId).some(mutation =>
        tasks && mutation.kind.startsWith('task') || calendar && mutation.kind.startsWith('event'));
      return shouldSyncAutomatically(this.schedule(account.accountId, now), { now, mode: settings.syncMode, reason, visible, readyWrites });
    });
    if (!accounts.length) return { skipped: true };
    return this.runSelected(accounts.map(account => account.accountId), { reason }, false);
  }

  private async runSelected(accountIds: string[], input: RecordValue, explicit: boolean, full = false): Promise<RecordValue> {
    this.selectedAccounts = new Set(accountIds);
    try {
      const now = Date.now();
      for (const accountId of accountIds) this.store.setGoogleOperationRecord(accountId, syncScheduleKey,
        beginSyncAttempt(this.schedule(accountId, now), now, explicit));
      if (accountIds.length) await this.saveSchedule();
      return full ? await this.service.forceFullResync(input) : await this.service.runNow(input);
    } finally { this.selectedAccounts = undefined; }
  }

  private runExplicit(input: RecordValue, full = false): Promise<RecordValue> {
    const accounts = this.store.googleAccounts().filter(account => this.hasSession(account.accountId) && (!input.accountId || input.accountId === account.accountId));
    return this.runSelected(accounts.map(account => account.accountId), input, true, full);
  }

  status(): RecordValue {
    const status = this.store.dispatch('google', 'status');
    const accounts = status.accounts.map((account: RecordValue) => ({
      ...account,
      connectionState: account.connectionState === 'connected' && !this.sessions.has(account.accountId, account.googleAccountId)
        ? 'reauth_required' : account.connectionState,
      missingScopes: ['https://www.googleapis.com/auth/tasks', 'https://www.googleapis.com/auth/calendar']
        .filter(scope => !(account.grantedScopes ?? []).includes(scope)),
      sessionExpiresAt: this.sessions.metadata(account.accountId)?.expiresAt ?? null,
    }));
    return { ...status, available: true, hasClientSecret: false, accounts, account: accounts[0] ?? null };
  }

  async dispatch(namespace: string, action: string, input: RecordValue = {}): Promise<DispatchResult> {
    let value: any;
    switch (`${namespace}.${action}`) {
      case 'google.status': value = this.status(); break;
      case 'sync.runNow': value = await this.runExplicit(input); break;
      case 'sync.forceFullResync': value = await this.runExplicit(input, true); break;
      case 'calendar.freeBusy': value = await this.service.queryFreeBusy(input); break;
      case 'google.searchDriveFiles': value = await this.service.searchDriveFiles(input); break;
      case 'google.searchGmailMessages': value = await this.service.searchGmailMessages(input); break;
      case 'google.captureGmailMessage': value = this.service.captureGmailMessage(input); break;
      case 'google.uploadDriveFile': {
        const file = input.file;
        if (!(file instanceof Blob) || typeof input.name !== 'string') throw new CoreStoreError('Choose a file to upload to Drive.');
        value = await this.service.uploadDriveSource({ accountId: input.accountId, source: {
          name: input.name, size: file.size, type: file.type,
          read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
        } });
        break;
      }
      case 'diagnostics.previewMutationResolution': value = await this.service.previewMutationResolution(input); break;
      case 'diagnostics.resolveMutation': value = await this.service.resolveMutation(input); break;
      default: return { handled: false };
    }
    return { handled: true, value };
  }
}
