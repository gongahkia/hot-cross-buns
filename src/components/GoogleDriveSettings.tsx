import { useState } from 'react';
import styled from 'styled-components';
import { Button, Field } from '../styles';
import type { GoogleConfig } from '../googleAuth';
import type { DriveFile } from '../googleDrive';
import type { DriveStatus } from '../useGoogleDrive';
import { RevisionHistoryInfo } from './JournalSyncStatus';

const Section = styled.section`margin-top:24px;padding-top:15px;border-top:1px solid var(--line);h3{display:flex;align-items:center;gap:9px;font-size:14px;margin:0 0 8px;}img{width:24px;height:24px;flex:none;}p{margin:7px 0;color:var(--muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere;}label{display:grid;gap:5px;margin-top:10px;font-size:12px;}input{width:100%;min-height:44px;}details{margin-top:10px;font-size:12px;}summary{padding:8px 0;cursor:pointer;}`;
const Actions = styled.div`display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;button{min-height:44px;}`;
const Files = styled.div`display:grid;gap:5px;max-height:200px;overflow:auto;margin-top:8px;button{text-align:left;overflow-wrap:anywhere;}`;
export function GoogleDriveSettings({ config, onConfigure, sdkReady, onRetrySdk, connected, email, status, linked, files, busy, error, localLinked, onConnect, onCreate, onPick, onOpen, onReview, onResume, onUnlink, onDisconnect, creationPending, onDismissCreation, onDownloadCreation, protectedHistory, historyStats, onEnableHistory }: {
  config: GoogleConfig; onConfigure: (config: GoogleConfig) => void; sdkReady: boolean; onRetrySdk: () => void; connected: boolean; email: string;
  status: DriveStatus; linked: boolean; files: DriveFile[]; busy: boolean; error: string; localLinked: boolean;
  creationPending: boolean; onDismissCreation: () => void; onDownloadCreation: () => void;
  onConnect: () => void; onCreate: () => void; onPick: () => void; onOpen: (id: string) => void; onReview: () => void; onResume: () => void; onUnlink: () => void; onDisconnect: () => void;
  protectedHistory: boolean; historyStats?: { count: number; bytes: number }; onEnableHistory: () => void;
}) {
  const supported = typeof navigator.locks?.request === 'function';
  const [draft, setDraft] = useState(config);
  const [configError, setConfigError] = useState('');
  const saveConfig = () => { try { onConfigure(draft); setConfigError(''); } catch (error) { setConfigError(String(error)); } };
  const message = status.kind === 'offline' ? 'Saved in this browser. Google Drive will catch up when you are online.'
    : status.kind === 'retrying' ? `Saved in this browser. Retrying Google Drive automatically. ${status.detail ?? ''}`
    : status.kind === 'waiting' ? status.detail ?? 'Finish editing to bring in Google Drive changes.'
    : status.kind === 'changed' ? `${status.name} changed in Google Drive. Review it before saving.`
    : status.kind === 'reauth' ? 'Reconnect the linked Google account in this tab to save here. Another connected window can keep syncing.'
    : status.kind === 'error' ? `Saving is paused. ${status.detail}`
    : status.kind === 'saving' ? `Saving ${status.name} to Google Drive…`
    : status.kind === 'saved' ? `${status.name} is up to date.${status.lastSavedAt ? ' Last written at ' + new Date(status.lastSavedAt).toLocaleTimeString() + '.' : ''}`
    : connected ? `Connected${email ? ' as ' + email : ''}. Create a journal or open an existing text file.` : 'Save TODO.txt directly to your Google Drive account.';
  return <Section aria-label="Google Drive"><h3><img src="/providers/google-drive.png" alt=""/>Google Drive</h3>
    <p>{message}</p>
    <p>Optional Google sign-in with your own Web OAuth client. Only files created or opened through this app are requested.</p>
    <p>New links keep immutable HCB-…json revision files in My Drive alongside the journal workflow. Keep those files to retain offline and concurrent changes. Use the same Web OAuth client ID on every device. Existing single-file links can enable history below.</p>
    {linked && <RevisionHistoryInfo enabled={protectedHistory} stats={historyStats}/>}
    <details open={!config.clientId}><summary>Google connection setup</summary>
      <label>Web OAuth client ID<Field autoComplete="off" spellCheck={false} aria-label="Google Web OAuth client ID" value={draft.clientId} onChange={event => setDraft({ ...draft, clientId: event.target.value })}/></label>
      <label>Picker API key (optional)<Field type="password" autoComplete="off" aria-label="Google Picker API key" value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })}/></label>
      <label>Cloud project number (for Picker)<Field inputMode="numeric" autoComplete="off" aria-label="Google Cloud project number" value={draft.projectNumber} onChange={event => setDraft({ ...draft, projectNumber: event.target.value })}/></label>
      <p>An API key alone cannot authorize private files. The Picker key and project number are needed to browse files not already opened by the app.</p>
      <Actions><Button type="button" disabled={busy} onClick={saveConfig}>Save Google configuration</Button></Actions>
    </details>
    {(error || configError) && <p role="alert">{configError || error}</p>}
    {localLinked && <p>Unlink the local file above before linking a Google Drive journal.</p>}
    {!supported && <p>This browser cannot link Google Drive files. Use a browser with Web Locks, or import and download TODO.txt manually.</p>}
    {creationPending && !linked && <div role="status" aria-label="Unconfirmed file creation"><p>The previous file creation may have finished. Connect the same account and choose its TODO.txt before creating another. Allowing another creation keeps any file already created.</p><Actions><Button type="button" disabled={busy} onClick={onDownloadCreation}>Download submitted journal</Button><Button type="button" disabled={busy} onClick={onDismissCreation}>Allow another creation</Button></Actions></div>}
    <Actions>{!connected || status.kind === 'reauth' ? <>
      <Button type="button" disabled={busy || !supported || !config.clientId || !sdkReady} title="Connect Google Drive" onClick={onConnect}>{busy ? 'Connecting…' : 'Connect Google Drive'}</Button>
      {!!config.clientId && !sdkReady && <Button type="button" disabled={busy} onClick={onRetrySdk}>Retry Google loading</Button>}
    </> : !linked ? <>
      <Button type="button" disabled={busy || !supported || localLinked || creationPending} onClick={onCreate}>Create TODO.txt in Google Drive</Button>
      <Button type="button" disabled={busy || !supported || localLinked || !config.apiKey || !config.projectNumber} onClick={onPick}>Choose from Google Drive</Button>
    </> : <>
      {!protectedHistory && <Button type="button" disabled={busy} onClick={onEnableHistory}>Enable Drive revision history</Button>}
      {status.kind === 'changed' && <Button type="button" disabled={busy} onClick={onReview}>Review Google Drive file</Button>}
      {['error', 'retrying', 'offline'].includes(status.kind) && <Button type="button" disabled={busy} onClick={onResume}>Resume Google Drive saving</Button>}
      {status.kind === 'saved' && <Button type="button" disabled={busy} onClick={onResume}>Check Google Drive now</Button>}
    </>}
    {linked && <Button type="button" disabled={busy} onClick={onUnlink}>Unlink Google Drive file</Button>}
    {connected && <Button type="button" disabled={busy} onClick={onDisconnect}>Sign out of this tab</Button>}</Actions>
    {connected && !linked && !localLinked && files.length > 0 && <><p>Recent text files opened by this app</p><Files aria-label="Google Drive journal files">{files.map(file => <Button key={file.id} type="button" disabled={busy} onClick={() => onOpen(file.id)}>{file.name}{file.modifiedTime ? ' · ' + new Date(file.modifiedTime).toLocaleDateString() : ''}</Button>)}</Files></>}
    <p>Saving runs while a tab is open and visible. Scratchpad text and appearance settings stay in this browser. Unlinking keeps the Google Drive file and browser journal.</p>
    <p><a href="https://github.com/gongahkia/hot-cross-buns/blob/main/docs/GOOGLE_DRIVE.md" target="_blank" rel="noreferrer">Google Drive setup guide</a></p>
  </Section>;
}
