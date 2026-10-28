import { CoreStore, CoreStoreError } from '@shared/core/CoreStore';
import { GoogleSyncService } from '@shared/google/GoogleSyncService';
import type { SyncCheckpoint } from '@shared/google/types';
import { BrowserGoogleSessions } from './googleSyncSessions';

type RecordValue = Record<string, any>;
type DispatchResult = { handled: true; value: any } | { handled: false };

/** All methods must be called by the worker's serialized, locked request path. */
export class BrowserGoogleSync {
  readonly service: GoogleSyncService;
  constructor(
    private readonly store: CoreStore,
    readonly sessions: BrowserGoogleSessions,
    checkpoint: (checkpoint: SyncCheckpoint) => Promise<void>,
  ) {
    this.service = new GoogleSyncService(store, {
      onConnectionChange: listener => sessions.onConnectionChange(listener),
      googleFetch: (accountId, url, init) => {
        const account = store.googleAccount(accountId);
        if (!account || account.connectionState !== 'connected' || !sessions.has(accountId, account.googleAccountId)) {
          throw new CoreStoreError('Reconnect the selected Google account before syncing. Its local data and pending changes are preserved.');
        }
        return sessions.googleFetch(accountId, url, init);
      },
    }, {
      checkpoint, automaticConnectionSync: false,
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
      case 'sync.runNow': value = await this.service.runNow(input); break;
      case 'sync.forceFullResync': value = await this.service.forceFullResync(input); break;
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
