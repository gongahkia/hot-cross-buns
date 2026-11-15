import styled from 'styled-components';
import { Button } from '../styles';
import { supportsLinkedFiles, type FileSyncStatus } from '../linkedFile';

const Section = styled.section`margin-top:24px;padding-top:15px;border-top:1px solid var(--line);h2{display:flex;align-items:center;gap:9px;font-size:14px;margin:0 0 8px;}h2 img{width:24px;height:24px;flex:none;}p{margin:7px 0;color:var(--muted);font-size:12px;line-height:1.5;}`;
const Actions = styled.div`display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;button{min-height:44px;}`;
export function fileSyncMessage(status: FileSyncStatus): string {
  if (status.kind === 'changed') return `${status.name} changed outside Hot Cross Buns. File saving is paused until you review it.`;
  if (status.kind === 'permission') return `Allow access to ${status.name} to resume file saving. Your journal is still available in this browser.`;
  if (status.kind === 'error') return `File saving is paused. Your journal is still available in this browser. ${status.detail}`;
  if (status.kind === 'saving') return `Saving ${status.name}… Keep this tab visible until the file is up to date.`;
  if (status.kind === 'saved') return `${status.name} is up to date. ${status.lastSavedAt ? `Last written at ${new Date(status.lastSavedAt).toLocaleTimeString()}.` : 'The file matches the browser journal.'}`;
  return 'Link TODO.txt in a Syncthing folder to save journal edits directly to that file.';
}
export function FileSyncSettings({ status, error, busy, onLink, onReview, onResume, onUnlink }: {
  status: FileSyncStatus; error: string; busy: boolean; onLink: (create: boolean) => void; onReview: () => void; onResume: () => void; onUnlink: () => void;
}) {
  return <Section aria-label="File sync"><h2><img src="/providers/syncthing.svg" alt="Syncthing"/>File sync</h2>
    <p>Use Syncthing or another free file sync tool to carry TODO.txt between devices. Hot Cross Buns saves the linked file while a tab is open and visible.</p>
    {error && <p role="alert">{error}</p>}
    {supportsLinkedFiles() ? <>
      <p role="status">{fileSyncMessage(status)}</p>
      <Actions>{status.kind === 'unlinked' ? <><Button disabled={busy} onClick={() => onLink(false)}>Link existing TODO.txt</Button><Button disabled={busy} onClick={() => onLink(true)}>Create linked TODO.txt</Button></> : <>
        {status.kind === 'changed' && <Button disabled={busy} onClick={onReview}>Review linked file</Button>}
        {(status.kind === 'permission' || status.kind === 'error') && <Button disabled={busy} onClick={onResume}>Resume file saving</Button>}
        <Button disabled={busy} onClick={onUnlink}>Unlink file</Button>
      </>}</Actions>
      <p>Let Syncthing finish before switching devices, then review any file-change notice. Scratchpad text and appearance settings stay in this browser. Unlinking keeps both the file and browser journal.</p>
    </> : <p>This browser cannot link local files. Use Commands → Import TODO.txt and Download TODO.txt with your synced folder.</p>}
  </Section>;
}
