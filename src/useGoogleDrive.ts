import { useEffect, useRef, useState } from 'react';
import { authorizeGoogle, pickGoogleFile, preloadGoogle, validateGoogleConfig, type GoogleConfig } from './googleAuth';
import { createDriveApi, GoogleDriveError, type DriveFile, type DriveLink, type DriveSnapshot, type GoogleSession } from './googleDrive';
import { fileSyncLock } from './linkedFile';
import { loadDriveLink, loadFileLink, loadTodoState, storeDriveLink } from './todoStore';
import { serializeTodoText, type TodoDocument } from './todoText';

export type DriveStatus = { kind: 'unlinked' | 'saved' | 'saving' | 'reauth' | 'changed' | 'error'; name?: string; detail?: string; lastSavedAt?: number | null };
const configKey = 'hot-cross-buns.google-drive-config';
function initialConfig(): GoogleConfig {
  const defaults = { clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '', apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? '', projectNumber: import.meta.env.VITE_GOOGLE_PROJECT_NUMBER ?? '' };
  try { const saved = JSON.parse(localStorage.getItem(configKey) ?? 'null') as GoogleConfig | null; return saved ? validateGoogleConfig(saved) : defaults; } catch { return defaults; }
}
export function useGoogleDrive(journal: TodoDocument | null, canSave: () => boolean, onNotice: (text: string) => void) {
  const [config, setConfig] = useState(initialConfig);
  const [sdkReady, setSdkReady] = useState(false);
  const [session, setSession] = useState<GoogleSession | null>(null);
  const [status, setStatus] = useState<DriveStatus>({ kind: 'unlinked' });
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const record = useRef<DriveLink | null>(null);
  const currentStatus = useRef(status);
  const permitted = useRef(canSave); permitted.current = canSave;
  const notify = useRef(onNotice); notify.current = onNotice;
  const activeSession = useRef(session); activeSession.current = session;
  const polling = useRef(false), operating = useRef(false), failed = useRef<string | null>(null);
  const publish = (next: DriveStatus) => {
    const previous = currentStatus.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    currentStatus.current = next; setStatus(next);
    if (next.kind === 'changed') notify.current('The Google Drive journal changed. Open Settings → Google Drive to review it.');
    if (next.kind === 'reauth') notify.current('Reconnect Google Drive in Settings to continue file saving.');
    if (next.kind === 'error') notify.current(next.detail ?? 'Google Drive saving is paused. Open Settings to resume.');
  };
  const api = () => {
    const current = activeSession.current;
    if (!current || current.expiresAt <= Date.now() + 30_000) throw new GoogleDriveError('Reconnect Google Drive to continue.', 401);
    if (record.current && record.current.accountId !== current.accountId) throw new GoogleDriveError('Reconnect using the Google account linked to this journal.', 401);
    return createDriveApi(current);
  };
  const poll = async () => {
    if (!journal || !navigator.locks || polling.current || operating.current || !permitted.current()) return;
    polling.current = true;
    try {
      await navigator.locks.request(fileSyncLock, async () => {
        if (!permitted.current() || operating.current) return;
        const previous = record.current;
        const link = await loadDriveLink(); record.current = link;
        if (!link) { failed.current = null; publish({ kind: 'unlinked' }); return; }
        if (previous?.id === link.id && previous.version !== link.version) failed.current = null;
        const current = activeSession.current;
        if (!current || current.accountId !== link.accountId || current.expiresAt <= Date.now() + 30_000) { publish({ kind: 'reauth', name: link.fileName }); return; }
        if (link.needsReview) { publish({ kind: 'changed', name: link.fileName }); return; }
        if (failed.current === link.id) return;
        const saved = await loadTodoState();
        if (!permitted.current()) return;
        const text = serializeTodoText(saved.document), client = api();
        const remote = await client.metadata(link.fileId);
        if (text === link.baselineText && remote.file.version === link.version) { publish({ kind: 'saved', name: link.fileName, lastSavedAt: link.lastSavedAt }); return; }
        const outcome = await client.save(link, text);
        if (outcome.kind === 'changed') {
          await storeDriveLink({ ...link, needsReview: true }); publish({ kind: 'changed', name: link.fileName }); return;
        }
        const next = { ...link, fileName: outcome.snapshot.file.name, version: outcome.snapshot.file.version, baselineText: text, baselineDocument: saved.document, lastSavedAt: outcome.kind === 'saved' ? Date.now() : link.lastSavedAt };
        await storeDriveLink(next); record.current = next;
        publish({ kind: 'saved', name: next.fileName, lastSavedAt: next.lastSavedAt });
      });
    } catch (cause) {
      if (cause instanceof GoogleDriveError && cause.status === 412 && record.current) {
        try { await navigator.locks.request(fileSyncLock, async () => { const link = await loadDriveLink(); if (link && link.id === record.current?.id) await storeDriveLink({ ...link, needsReview: true }); }); publish({ kind: 'changed', name: record.current.fileName }); }
        catch (error) { failed.current = record.current.id; publish({ kind: 'error', name: record.current.fileName, detail: String(error) }); }
      } else if (cause instanceof GoogleDriveError && cause.status === 401) { setSession(null); publish({ kind: 'reauth', name: record.current?.fileName }); }
      else { failed.current = record.current?.id ?? null; publish({ kind: 'error', name: record.current?.fileName, detail: String(cause) }); }
    } finally { polling.current = false; }
  };
  const pollRef = useRef(poll); pollRef.current = poll;
  useEffect(() => {
    if (!config.clientId) { setSdkReady(false); return; }
    let active = true;
    void preloadGoogle().then(() => { if (active) { setSdkReady(true); setError(''); } }).catch(error => { if (active) { setSdkReady(false); setError(String(error)); } });
    return () => { active = false; };
  }, [config]);
  useEffect(() => {
    if (!journal) return;
    const check = () => { if (document.visibilityState === 'visible') void pollRef.current(); };
    check(); const timer = window.setInterval(check, 15_000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [journal !== null]);
  useEffect(() => { if (!journal) return; const timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void pollRef.current(); }, 1500); return () => clearTimeout(timer); }, [journal]);
  useEffect(() => { if (!session) return; const timer = window.setTimeout(() => { setSession(null); if (record.current) publish({ kind: 'reauth', name: record.current.fileName }); }, Math.min(2_147_483_647, Math.max(0, session.expiresAt - Date.now() - 30_000))); return () => clearTimeout(timer); }, [session]);
  const configure = (next: GoogleConfig) => {
    const clean = validateGoogleConfig(next); localStorage.setItem(configKey, JSON.stringify(clean)); setConfig(clean); setSession(null); activeSession.current = null; setFiles([]); setError('');
    if (record.current) publish({ kind: 'reauth', name: record.current.fileName });
  };
  const connect = async () => {
    if (operating.current) return;
    operating.current = true; setBusy(true); setError('');
    try {
      const authorization = authorizeGoogle(config, record.current ? { accountId: record.current.accountId, email: record.current.email } : undefined);
      const connected = await authorization; activeSession.current = connected; setSession(connected); failed.current = null;
      setFiles(await createDriveApi(connected).list());
      notify.current(`Connected Google Drive${connected.email ? ' as ' + connected.email : ''}.`);
    } catch (error) { setError(String(error)); throw error; }
    finally { operating.current = false; setBusy(false); void pollRef.current(); }
  };
  const writeLink = async (snapshot: DriveSnapshot, baselineDocument: TodoDocument, expectedId: string | null, created: boolean) => {
    const connected = activeSession.current;
    if (!connected) throw new Error('Reconnect Google Drive before linking a file.');
    if (await loadFileLink()) throw new Error('Unlink the local file before linking Google Drive.');
    const previous = await loadDriveLink();
    if ((previous?.id ?? null) !== expectedId) throw new Error('The Google Drive link changed in another window. Review it again.');
    const link: DriveLink = { id: previous?.id ?? crypto.randomUUID(), fileId: snapshot.file.id, fileName: snapshot.file.name, accountId: connected.accountId, email: connected.email, baselineText: snapshot.text, baselineDocument, version: snapshot.file.version, needsReview: false, lastSavedAt: created ? Date.now() : previous?.lastSavedAt ?? null };
    await storeDriveLink(link); record.current = link; failed.current = null; publish({ kind: 'saved', name: link.fileName, lastSavedAt: link.lastSavedAt });
  };
  const establish = (snapshot: DriveSnapshot, baselineDocument: TodoDocument, expectedId: string | null = null) => navigator.locks.request(fileSyncLock, () => writeLink(snapshot, baselineDocument, expectedId, false));
  const create = async () => {
    if (operating.current) throw new Error('Finish the Google Drive operation already in progress.');
    operating.current = true; setBusy(true); setError('');
    try {
      // reserve the target choice while the new file is created; journal writes use separate IDB transactions.
      const snapshot = await navigator.locks.request(fileSyncLock, async () => {
        if (await loadFileLink() || await loadDriveLink()) throw new Error('Unlink the current file before creating another linked journal.');
        const saved = await loadTodoState();
        const snapshot = await api().create(serializeTodoText(saved.document));
        await writeLink(snapshot, saved.document, null, true);
        return snapshot;
      });
      setFiles(current => [snapshot.file, ...current].slice(0, 20));
      notify.current('Created TODO.txt in Google Drive.');
    } catch (error) { setError(String(error)); throw error; }
    finally { operating.current = false; setBusy(false); }
  };
  const read = async (id?: string) => {
    const link = await loadDriveLink();
    if (!id && !link) throw new Error('The Google Drive file has been unlinked.');
    return { snapshot: await api().read(id ?? link!.fileId), ...(id ? {} : { id: link!.id, baselineDocument: link!.baselineDocument }) };
  };
  const pick = async () => { const connected = activeSession.current; if (!connected) throw new Error('Connect Google Drive first.'); const id = await pickGoogleFile(config, connected); return id ? read(id) : null; };
  const resume = async () => { failed.current = null; setError(''); await pollRef.current(); };
  const unlink = async () => { await navigator.locks.request(fileSyncLock, async () => { await storeDriveLink(null); record.current = null; failed.current = null; publish({ kind: 'unlinked' }); }); };
  const disconnect = () => { activeSession.current = null; setSession(null); setFiles([]); if (record.current) publish({ kind: 'reauth', name: record.current.fileName }); };
  const retrySdk = async () => { setError(''); try { await preloadGoogle(); setSdkReady(true); } catch (error) { setError(String(error)); throw error; } };
  const pending = status.kind === 'saved' && record.current && journal && serializeTodoText(journal) !== record.current.baselineText;
  return { config, configure, sdkReady, retrySdk, session, status: pending ? { ...status, kind: 'saving' as const } : status, linked: !!record.current, files, busy, error, connect, establish, create, read, pick, resume, unlink, disconnect };
}
