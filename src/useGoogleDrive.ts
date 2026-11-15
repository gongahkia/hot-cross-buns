import { assertImportText } from './importLimits';
import { useEffect, useRef, useState } from 'react';
import { authorizeGoogle, pickGoogleFile, preloadGoogle, validateGoogleConfig, type GoogleConfig } from './googleAuth';
import { createDriveApi, GoogleDriveError, type DriveFile, type DriveLink, type DriveSnapshot, type GoogleSession } from './googleDrive';
import { fileSyncLock } from './linkedFile';
import { loadDriveLink, loadFileLink, loadTodoState, storeDriveLink, readSyncBundle, loadSyncCreation, storeSyncCreation, subscribeStore, commitReviewedLink, type ReviewedJournal, type SyncCreation } from './todoStore';
import { useJournalSync } from './useJournalSync';
import type { SyncAdapter, SyncStatus } from './journalSync';
import { serializeTodoText, type TodoDocument } from './todoText';

export type DriveStatus = SyncStatus;
const configKey = 'hot-cross-buns.google-drive-config';
function initialConfig(): GoogleConfig {
  const defaults = { clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '', apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? '', projectNumber: import.meta.env.VITE_GOOGLE_PROJECT_NUMBER ?? '' };
  try { const saved = JSON.parse(localStorage.getItem(configKey) ?? 'null') as GoogleConfig | null; return saved ? validateGoogleConfig(saved) : defaults; } catch { return defaults; }
}
export function useGoogleDrive(journal: TodoDocument | null, canSave: () => boolean, onNotice: (text: string) => void, validate?: (document: TodoDocument) => void) {
  const [config, setConfig] = useState(initialConfig);
  const [sdkReady, setSdkReady] = useState(false);
  const [session, setSession] = useState<GoogleSession | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creation, setCreation] = useState<SyncCreation | null>(null);
  const [creationLoaded, setCreationLoaded] = useState(false);
  const creationRef = useRef(creation); creationRef.current = creation;
  useEffect(() => {
    let active = true;
    const refresh = () => { void loadSyncCreation().then(value => { if (active) { creationRef.current = value; setCreation(value); setCreationLoaded(true); } }).catch(error => { if (active) { setError(String(error)); setCreationLoaded(true); } }); };
    refresh(); const unsubscribe = subscribeStore('sync', refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  const record = useRef<DriveLink | null>(null);
  const notify = useRef(onNotice); notify.current = onNotice;
  const activeSession = useRef(session); activeSession.current = session;
  const operating = useRef(false);
  const api = () => {
    const current = activeSession.current;
    if (!current || current.expiresAt <= Date.now() + 30_000) throw new GoogleDriveError('Reconnect Google Drive to continue.', 401);
    if (record.current && record.current.accountId !== current.accountId) throw new GoogleDriveError('Reconnect using the Google account linked to this journal.', 401);
    return createDriveApi(current);
  };
  const authenticated = async <T,>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { if (error instanceof GoogleDriveError && error.status === 401) { activeSession.current = null; setSession(null); } throw error; }
  };
  const adapter: SyncAdapter<DriveLink, DriveSnapshot> = {
    name: link => link.fileName,
    ready: async link => {
      const current = activeSession.current;
      return !current || current.accountId !== link.accountId || current.expiresAt <= Date.now() + 30_000 ? 'reauth' : null;
    },
    read: (link, dirty) => authenticated(async () => {
      const client = api();
      if (!dirty) { const metadata = await client.metadata(link.fileId); if (metadata.file.version === link.version) return { ...metadata, text: link.baselineText }; }
      return client.read(link.fileId);
    }),
    write: (link, text) => authenticated(() => api().save(link, text)),
    acknowledge: (link, snapshot, document, wrote, now) => ({ ...link, fileName: snapshot.file.name, version: snapshot.file.version, baselineText: snapshot.text, baselineDocument: document, lastSavedAt: wrote ? now : link.lastSavedAt }),
    classify: error => error instanceof GoogleDriveError ? error.status === 401 ? 'reauth' : error.status === 412 ? 'changed' : [408, 429, 500, 502, 503, 504].includes(error.status) ? 'retrying' : 'error' : error instanceof TypeError || error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name) ? 'retrying' : 'error',
    network: true,
  };
  const sync = useJournalSync('drive', journal, () => canSave() && !operating.current, adapter, 15_000, true, validate);
  record.current = sync.record;
  const previousStatus = useRef('unlinked');
  useEffect(() => {
    const kind = sync.status.kind;
    if (previousStatus.current === kind) return;
    previousStatus.current = kind;
    if (kind === 'changed') notify.current('The Google Drive journal changed or needs review. Open Settings → Google Drive.');
    if (kind === 'reauth') notify.current('Reconnect Google Drive in Settings to continue file saving.');
    if (kind === 'error') notify.current(sync.status.detail ?? 'Google Drive saving is paused. Open Settings to resume.');
    if (kind === 'retrying' && sync.status.detail) notify.current(sync.status.detail);
  }, [sync.status.kind]);
  useEffect(() => {
    if (!config.clientId) { setSdkReady(false); return; }
    let active = true;
    void preloadGoogle().then(() => { if (active) { setSdkReady(true); setError(''); } }).catch(error => { if (active) { setSdkReady(false); setError(String(error)); } });
    return () => { active = false; };
  }, [config]);
  useEffect(() => { if (!session) return; const timer = window.setTimeout(() => { activeSession.current = null; setSession(null); void sync.poll(); }, Math.min(2_147_483_647, Math.max(0, session.expiresAt - Date.now() - 30_000))); return () => clearTimeout(timer); }, [session]);
  const configure = (next: GoogleConfig) => {
    const clean = validateGoogleConfig(next); localStorage.setItem(configKey, JSON.stringify(clean)); setConfig(clean); setSession(null); activeSession.current = null; setFiles([]); setError('');
    void sync.poll();
  };
  const connect = async () => {
    if (operating.current) return;
    operating.current = true; setBusy(true); setError('');
    try {
      const expected = record.current ?? creationRef.current;
      const authorization = authorizeGoogle(config, expected ? { accountId: expected.accountId, email: expected.email } : undefined);
      const connected = await authorization; activeSession.current = connected; setSession(connected);
      setFiles(await authenticated(() => createDriveApi(connected).list()));
      notify.current(`Connected Google Drive${connected.email ? ' as ' + connected.email : ''}.`);
    } catch (error) { setError(String(error)); throw error; }
    finally { operating.current = false; setBusy(false); void sync.poll(true); }
  };
  const writeLink = async (snapshot: DriveSnapshot, baselineDocument: TodoDocument, expectedId: string | null, created: boolean, review?: ReviewedJournal) => {
    const connected = activeSession.current;
    if (!connected) throw new Error('Reconnect Google Drive before linking a file.');
    if (await loadFileLink()) throw new Error('Unlink the local file before linking Google Drive.');
    const previous = await loadDriveLink();
    if ((previous?.id ?? null) !== expectedId) throw new Error('The Google Drive link changed in another window. Review it again.');
    const link: DriveLink = { id: previous?.id ?? crypto.randomUUID(), fileId: snapshot.file.id, fileName: snapshot.file.name, accountId: connected.accountId, email: connected.email, baselineText: snapshot.text, baselineDocument, version: snapshot.file.version, needsReview: false, lastSavedAt: created ? Date.now() : previous?.lastSavedAt ?? null };
    if (review) return commitReviewedLink('drive', link, expectedId, review);
    await storeDriveLink(link); record.current = link; return null;
  };
  const establish = async (snapshot: DriveSnapshot, baselineDocument: TodoDocument, expectedId: string | null = null, review?: ReviewedJournal) => { const result = await navigator.locks.request(fileSyncLock, () => writeLink(snapshot, baselineDocument, expectedId, false, review)); await sync.refresh(); return result; };
  const create = async () => {
    if (operating.current) throw new Error('Finish the Google Drive operation already in progress.');
    operating.current = true; setBusy(true); setError('');
    let ticket: SyncCreation | null = null;
    try {
      await navigator.locks.request('hot-cross-buns-sync-delivery', async () => {
        const pending = await navigator.locks.request(fileSyncLock, async () => {
          if (await loadFileLink() || await loadDriveLink()) throw new Error('Unlink the current file before creating another linked journal.');
          if (await loadSyncCreation()) throw new Error('The previous file creation may have finished. Choose that file or allow another creation in Settings.');
          const connected = activeSession.current;
          if (!connected) throw new Error('Connect Google Drive first.');
          const saved = await loadTodoState();
          const text = serializeTodoText(saved.document); assertImportText(text);
          const pending: SyncCreation = { id: crypto.randomUUID(), accountId: connected.accountId, email: connected.email, createdAt: Date.now(), text, document: saved.document, uncertain: true };
          if (!await storeSyncCreation(null, pending)) throw new Error('Another window already started file creation.');
          return pending;
        });
        ticket = pending;
        // the durable ticket owns this creation; local edits and target choices stay available during HTTP.
        const snapshot = await authenticated(() => api().create(pending.text));
        await navigator.locks.request(fileSyncLock, async () => {
          if ((await loadSyncCreation())?.id !== pending.id) throw new Error('The file was created, but its link was cancelled. Choose the file from Google Drive to use it.');
          await writeLink(snapshot, pending.document, null, true);
        });
        setFiles(current => [snapshot.file, ...current].slice(0, 20));
        notify.current('Created TODO.txt in Google Drive.');
      });
    } catch (error) {
      if (ticket && error instanceof GoogleDriveError && error.status >= 400 && error.status < 500 && error.status !== 408) await storeSyncCreation((ticket as SyncCreation).id, null);
      setError(String(error)); throw error;
    } finally { operating.current = false; setBusy(false); await sync.refresh(); void sync.poll(true); }
  };
  const dismissCreation = async () => {
    const current = creationRef.current;
    if (current) await navigator.locks.request(fileSyncLock, () => storeSyncCreation(current.id, null));
    creationRef.current = null; setCreation(null); setError('');
  };
  const read = async (id?: string) => {
    const link = await loadDriveLink();
    if (!id && !link) throw new Error('The Google Drive file has been unlinked.');
    const bundle = id ? null : await readSyncBundle<DriveLink>('drive');
    return { snapshot: await api().read(id ?? link!.fileId), ...(id ? {} : { id: link!.id, generation: bundle?.ledger.generation, baselineDocument: (bundle?.ledger.checkpoint?.uncertain ? bundle.ledger.checkpoint.document : link!.baselineDocument) }) };
  };
  const pick = async () => { const connected = activeSession.current; if (!connected) throw new Error('Connect Google Drive first.'); const id = await pickGoogleFile(config, connected); return id ? read(id) : null; };
  const resume = async () => { setError(''); await sync.poll(true); };
  const unlink = async () => { await navigator.locks.request(fileSyncLock, () => storeDriveLink(null)); record.current = null; await sync.refresh(); };
  const disconnect = () => { activeSession.current = null; setSession(null); setFiles([]); void sync.poll(); };
  const retrySdk = async () => { setError(''); try { await preloadGoogle(); setSdkReady(true); } catch (error) { setError(String(error)); throw error; } };
  return { config, configure, sdkReady, retrySdk, session, status: sync.status, linked: !!sync.record, recovery: sync.ledger?.recovery, files, busy: busy || !creationLoaded, error, creation, dismissCreation, connect, establish, create, read, pick, resume, unlink, disconnect };
}
