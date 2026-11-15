import styled from 'styled-components';
import { Button } from '../styles';
import type { SyncStatus } from '../journalSync';
import { supportsLinkedFiles, supportsSyncFolders } from '../linkedFile';
import { RevisionHistoryInfo } from './JournalSyncStatus';

const Section = styled.section`margin-top:24px;padding-top:15px;border-top:1px solid var(--line);h2{display:flex;align-items:center;gap:9px;font-size:14px;margin:0 0 8px;}h2 img{width:24px;height:24px;flex:none;}p{margin:7px 0;color:var(--muted);font-size:12px;line-height:1.5;}`;
const Actions = styled.div`display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;button{min-height:44px;}`;
export function fileSyncMessage(status: SyncStatus): string {
  if (status.kind === 'waiting') return status.detail ?? 'Finish editing to bring in file changes.';
  if (status.kind === 'offline') return 'Saved in this browser. Waiting for a connection to save the file.';
  if (status.kind === 'retrying') return `Saved in this browser. File saving will retry automatically. ${status.detail ?? ''}`;
  if (status.kind === 'changed') return `${status.name} changed outside Hot Cross Buns. File saving is paused until you review it.`;
  if (status.kind === 'permission') return `Allow access to ${status.name} to resume file saving. Your journal is still available in this browser.`;
  if (status.kind === 'error') return `File saving is paused. Your journal is still available in this browser. ${status.detail}`;
  if (status.kind === 'saving') return `Saving ${status.name}… Keep this tab visible until the file is up to date.`;
  if (status.kind === 'saved') return `${status.name} is up to date. ${status.lastSavedAt ? `Last written at ${new Date(status.lastSavedAt).toLocaleTimeString()}.` : 'The file matches the browser journal.'}`;
  return 'Link TODO.txt in a Syncthing folder to save journal edits directly to that file.';
}
export function FileSyncSettings({ status, error, busy, onLink, onReview, onResume, onUnlink, onFolder, protectedHistory, historyStats, onEnableHistory }: {
  status: SyncStatus; error: string; busy: boolean; onLink: (create: boolean) => void; onReview: () => void; onResume: () => void; onUnlink: () => void;
  onFolder: () => void; protectedHistory: boolean; historyStats?: { count: number; bytes: number }; onEnableHistory: () => void;
}) {
  return <Section aria-label="File sync"><h2><img src="/providers/syncthing.svg" alt="Syncthing"/>File sync</h2>
    <p>Use Syncthing or another free file sync tool to carry TODO.txt between devices. Hot Cross Buns saves the linked file while a tab is open and visible.</p>
    {error && <p role="alert">{error}</p>}
    {supportsLinkedFiles() ? <>
      <p role="status">{fileSyncMessage(status)}</p>
      <p>Link the whole journal folder for revision history. Sync TODO.txt and its .hot-cross-buns folder together. The individual-file options below use single-file mode.</p>
      {status.kind !== 'unlinked' && <RevisionHistoryInfo enabled={protectedHistory} stats={historyStats}/>}
      <Actions>{status.kind === 'unlinked' ? <>{supportsSyncFolders() && <Button $primary disabled={busy} onClick={onFolder}>Link sync folder</Button>}<Button disabled={busy} onClick={() => onLink(false)}>Link existing TODO.txt</Button><Button disabled={busy} onClick={() => onLink(true)}>Create linked TODO.txt</Button></> : <>
        {!protectedHistory && supportsSyncFolders() && <Button disabled={busy} onClick={onEnableHistory}>Enable folder revision history</Button>}
        {status.kind === 'changed' && <Button disabled={busy} onClick={onReview}>Review linked file</Button>}
        {(status.kind === 'permission' || status.kind === 'error') && <Button disabled={busy} onClick={onResume}>Resume file saving</Button>}
        <Button disabled={busy} onClick={onUnlink}>Unlink file</Button>
      </>}</Actions>
      <p>Let Syncthing finish before switching devices, then review any file-change notice. Scratchpad text and appearance settings stay in this browser. Unlinking keeps both the file and browser journal.</p>
    </> : <p>This browser cannot link local files. Use Commands → Import TODO.txt and Download TODO.txt with your synced folder.</p>}
  </Section>;
}
