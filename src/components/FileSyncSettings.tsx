import styled from 'styled-components';
import { Button } from '../styles';
import type { SyncStatus } from '../journalSync';
import { supportsLinkedFiles, supportsSyncFolders } from '../linkedFile';
import { RevisionHistoryInfo } from './JournalSyncStatus';

const Section = styled.section`margin-top:24px;padding-top:15px;border-top:1px solid var(--line);h2,h3{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:400;margin:0 0 8px;}h3 a{display:flex;align-items:center;}h3 img{width:24px;height:24px;object-fit:contain;flex:none;}p,li{margin:7px 0;color:var(--muted);font-size:12px;line-height:1.5;}section ul,ol{margin:8px 0;padding-left:18px;font-size:12px;color:var(--muted);overflow-wrap:anywhere;}details{margin-top:12px;}summary{min-height:44px;padding:12px 0;font-size:12px;cursor:pointer;}`;
const Provider = styled.section`margin-top:24px;padding-top:15px;border-top:1px solid var(--line);`;
const Actions = styled.div`display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;button{min-height:44px;}`;
const providers = [
  { name: 'Syncthing', site: 'https://syncthing.net/', icon: 'syncthing.svg', button: 'Link sync folder',
    description: 'Carry your journal directly between devices with Syncthing, a free, open source sync tool.',
    setup: ['Install Syncthing on each device and pair them using their device IDs in Syncthing.', 'Share a dedicated journal folder with every editing device. Include TODO.txt and the hidden .hot-cross-buns directory.', 'Choose that local folder below. Let Syncthing finish transferring the complete folder before switching devices.'],
    guide: 'https://github.com/gongahkia/hot-cross-buns/blob/main/docs/FILE_SYNC.md' },
  { name: 'Nextcloud', site: 'https://nextcloud.com/home-users/', icon: 'nextcloud.svg', button: 'Link Nextcloud folder',
    description: 'Keep your journal in a Nextcloud desktop folder backed by your own server or a hosting provider.',
    setup: ['Install the Nextcloud desktop client. Enter your server address and sign in there; Hot Cross Buns does not need your server password.', 'Create a dedicated journal folder inside Nextcloud and keep its entire contents available offline. Include hidden .hot-cross-buns history in your sync selections and ignored-file settings.', 'Choose that local folder below. Check the Nextcloud client for completed upload and download before switching devices.'],
    guide: 'https://github.com/gongahkia/hot-cross-buns/blob/main/docs/SYNC_FOLDERS.md#nextcloud-first' },
  { name: 'Dropbox', site: 'https://www.dropbox.com/', icon: 'dropbox.svg', button: 'Link Dropbox folder',
    description: 'Keep your journal in a Dropbox desktop folder and let the Dropbox app carry it between computers.',
    setup: ['Install the Dropbox desktop app and sign in to your account there. No Dropbox API key or password is needed in Hot Cross Buns.', 'Create a dedicated journal folder in Dropbox. Include it in selective sync on every computer and choose Make available offline for its complete contents, including hidden .hot-cross-buns history.', 'Choose that local folder below. Wait for Dropbox to finish uploading and downloading before switching devices; keep any conflicted copies for review.'],
    guide: 'https://github.com/gongahkia/hot-cross-buns/blob/main/docs/SYNC_FOLDERS.md#dropbox-second' },
];
export function fileSyncMessage(status: SyncStatus): string {
  if (status.kind === 'waiting') return status.detail ?? 'Finish editing to bring in file changes.';
  if (status.kind === 'offline') return 'Saved in this browser. Waiting for a connection to save the file.';
  if (status.kind === 'retrying') return `Saved in this browser. File saving will retry automatically. ${status.detail ?? ''}`;
  if (status.kind === 'changed') return `${status.name} changed outside Hot Cross Buns. File saving is paused until you review it.`;
  if (status.kind === 'permission') return `Allow access to ${status.name} to resume file saving. Your journal is still available in this browser.`;
  if (status.kind === 'error') return `File saving is paused. Your journal is still available in this browser. ${status.detail}`;
  if (status.kind === 'saving') return `Saving ${status.name}… Keep this tab visible until the file is up to date.`;
  if (status.kind === 'saved') return `${status.name} is up to date in this folder. ${status.lastSavedAt ? `Last written at ${new Date(status.lastSavedAt).toLocaleTimeString()} (local folder).` : 'The file matches the browser journal.'}`;
  return 'Link the journal folder to save TODO.txt and its revision history.';
}
export function FileSyncSettings({ status, error, busy, onLink, onReview, onResume, onUnlink, onFolder, protectedHistory, historyStats, onEnableHistory, conflictCopies = [], onImportConflict }: {
  status: SyncStatus; error: string; busy: boolean; onLink: (create: boolean) => void; onReview: () => void; onResume: () => void; onUnlink: () => void;
  onFolder: () => void; protectedHistory: boolean; historyStats?: { count: number; bytes: number }; onEnableHistory: () => void;
  conflictCopies?: string[]; onImportConflict?: () => void;
}) {
  const foldersSupported = supportsSyncFolders(), linked = status.kind !== 'unlinked';
  return <Section aria-label="File sync"><h2>Local sync folders</h2>
    <p>Choose one folder for this journal. Hot Cross Buns writes TODO.txt and its revision history while this tab is open and visible.</p>
    {error && <p role="alert">{error}</p>}
    {supportsLinkedFiles() ? <>
      <p role="status">{fileSyncMessage(status)}</p>
      <p>Sync TODO.txt and its .hot-cross-buns folder together. Unlink the current journal before choosing another folder or Google Drive.</p>
      {status.kind !== 'unlinked' && <RevisionHistoryInfo enabled={protectedHistory} stats={historyStats}/>}
      {!!conflictCopies.length && <section aria-label="Sync folder conflict copies"><p>{conflictCopies.length} {conflictCopies.length === 1 ? 'provider conflict copy is' : 'provider conflict copies are'} present in this folder. Keep these files and import any changes you need; they are never merged or deleted automatically.</p><ul>{conflictCopies.slice(0, 5).map(name => <li key={name}>{name}</li>)}</ul>{conflictCopies.length > 5 && <p>And {conflictCopies.length - 5} more.</p>}{onImportConflict && <Button disabled={busy} onClick={onImportConflict}>Import a conflict copy</Button>}</section>}
      {linked && <Actions>
        {!protectedHistory && supportsSyncFolders() && <Button disabled={busy} onClick={onEnableHistory}>Enable folder revision history</Button>}
        {status.kind === 'changed' && <Button disabled={busy} onClick={onReview}>Review linked file</Button>}
        {(status.kind === 'permission' || status.kind === 'error') && <Button disabled={busy} onClick={onResume}>Resume file saving</Button>}
        <Button disabled={busy} onClick={onUnlink}>Unlink file</Button>
      </Actions>}
      <p>A local save does not confirm cloud upload or delivery to another device. Check your sync client before switching devices. Scratchpad and appearance settings stay in this browser. Unlinking keeps both copies.</p>
    </> : <p>This browser cannot link local files. Use Commands → Import TODO.txt and Download TODO.txt with your synced folder.</p>}
    {providers.map(provider => <Provider key={provider.name} aria-label={provider.name}>
      <h3 aria-label={provider.name}><a href={provider.site} target="_blank" rel="noreferrer" aria-label={`${provider.name} website`}><img src={`/providers/${provider.icon}`} alt={provider.name}/></a>{provider.name}</h3>
      <p>{provider.description}</p>
      <details><summary>{provider.name} setup</summary><ol>{provider.setup.map(step => <li key={step}>{step}</li>)}</ol><p><a href={provider.guide} target="_blank" rel="noreferrer">{provider.name} setup and recovery guide</a></p></details>
      {foldersSupported ? <Actions><Button type="button" disabled={busy || linked} onClick={onFolder}>{provider.button}</Button></Actions> : <p>Folder linking is unavailable in this browser. Use import and download with your synced folder.</p>}
    </Provider>)}
    {supportsLinkedFiles() && !linked && <Provider aria-label="Individual-file options"><h3>Individual-file options</h3><p>Single-file mode saves TODO.txt without shared revision history. Link a provider folder above to retain concurrent app-authored versions.</p><Actions><Button disabled={busy} onClick={() => onLink(false)}>Link existing TODO.txt</Button><Button disabled={busy} onClick={() => onLink(true)}>Create linked TODO.txt</Button></Actions></Provider>}
  </Section>;
}
