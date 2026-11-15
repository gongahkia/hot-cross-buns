import styled from 'styled-components';
import { CloudCheck, CloudOff, LoaderCircle, CircleAlert } from 'lucide-react';
import { Button } from '../styles';
import type { SyncRecovery, SyncStatus } from '../journalSync';

const Status = styled.div`display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-height:24px;margin:0 0 14px;color:var(--muted);font-size:11px;line-height:1.5;button{font-size:11px;min-height:32px;padding:3px 8px;}`;
const Recovery = styled.section`margin-top:18px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);h3{font-size:14px;margin-bottom:8px;color:var(--ink);}p{margin-bottom:8px;line-height:1.5;}div{display:flex;gap:8px;flex-wrap:wrap;}`;
export function JournalSyncStatus({ status, provider, draft, saving, onSettings, conflictCopies = 0 }: { status: SyncStatus; provider: 'file' | 'drive'; draft: boolean; saving: boolean; onSettings: () => void; conflictCopies?: number }) {
  if (status.kind === 'unlinked' || provider === 'file' && ['changed', 'permission', 'error'].includes(status.kind)) return null;
  const attention = ['changed', 'permission', 'error', 'reauth'].includes(status.kind) || conflictCopies > 0;
  const local = draft ? 'Editing on this device. Finish the field to save.' : saving ? 'Saving on this device…' : 'Saved in this browser.';
  const remote = status.kind === 'changed' ? 'File changes need review.'
    : status.kind === 'reauth' ? 'Reconnect this tab to continue saving to Google Drive.'
    : status.kind === 'error' || status.kind === 'permission' ? 'File saving needs attention.'
    : status.kind === 'offline' ? 'Google Drive will catch up when online.'
    : status.kind === 'retrying' ? 'File saving will retry automatically.'
    : status.kind === 'waiting' ? status.detail ?? 'Finish editing to bring in file changes.'
    : status.kind === 'saving' ? `Saving ${status.name}…`
    : draft || saving ? 'The file reflects the last saved journal.' : `${status.name} is up to date${provider === 'file' ? ' in this folder' : ''}.`;
  const text = `${local} ${remote}${conflictCopies ? ` ${conflictCopies} provider conflict ${conflictCopies === 1 ? 'copy is' : 'copies are'} present in the sync folder.` : ''}`;
  const Icon = attention ? CircleAlert : status.kind === 'offline' ? CloudOff : ['saving', 'retrying'].includes(status.kind) || saving ? LoaderCircle : CloudCheck;
  return <Status role="status" aria-label="Journal sync" title={status.lastCheckedAt ? 'Last checked at ' + new Date(status.lastCheckedAt).toLocaleTimeString() : undefined}><Icon size={14} aria-hidden="true"/><span>{text}</span>{attention && <Button type="button" onClick={onSettings}>Sync settings</Button>}</Status>;
}
export function SyncRecoveryFiles({ recovery, onDownload }: { recovery: SyncRecovery | undefined; onDownload: (text: string, name: string) => void }) {
  if (!recovery) return null;
  return <Recovery aria-label="Sync recovery copies"><h3>Recovery copies</h3><p>Copies from the latest sync comparison ({new Date(recovery.at).toLocaleString()}). Download either copy before resolving a conflict, or import one through the normal review. These copies stay in this browser while this file is linked; the next comparison replaces them.</p><div><Button type="button" onClick={() => onDownload(recovery.local, 'TODO-browser-before-sync.txt')}>Download browser copy</Button><Button type="button" onClick={() => onDownload(recovery.remote, 'TODO-file-before-sync.txt')}>Download file copy</Button></div></Recovery>;
}
export function RevisionHistoryInfo({ enabled, stats }: { enabled: boolean; stats?: { count: number; bytes: number } }) {
  return <p>{enabled ? 'Revision history is enabled. Concurrent app changes are kept for review before TODO.txt is updated.' : 'Single-file mode has no shared revision history. A competing write can replace an edit before the app observes it.'}{enabled && <> {stats ? `${stats.count} / 1,000 revisions · ${(stats.bytes / 1048576).toFixed(1)} / 64 MiB.` : 'Preparing history…'} History is never pruned automatically; saving pauses at the limit. Archive the complete history before starting a new target.</>}</p>;
}
