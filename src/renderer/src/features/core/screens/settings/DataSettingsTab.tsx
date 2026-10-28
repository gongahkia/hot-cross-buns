import { Archive, Download, FolderOpen, RotateCcw } from "lucide-react";
import type { SettingsSnapshot, SettingsUpdateRequest } from "@shared/ipc/contracts";
import { Button, Input } from "../../../../components/primitives";
import { SettingsControlRow, SettingsGroup, SettingsSwitch } from "./SettingsPrimitives";

export function DataSettingsTab({ settings, pending, updateSettings, runAction, browserStorage = false }: {
  browserStorage?: boolean;
  settings: SettingsSnapshot;
  pending: boolean;
  updateSettings: (request: SettingsUpdateRequest) => void;
  runAction: (action: string) => void;
}): JSX.Element {
  return (
    <div className="grid gap-5">
      <SettingsGroup title="Where your data lives">
        <p className="px-3 py-3 text-sm text-text-secondary">{browserStorage
          ? "Tasks, calendar events, notes, settings, and undo history are saved in this site's IndexedDB storage in your current browser profile. Changes are confirmed only after the browser saves them. Google sync is unavailable in this release."
          : "Tasks and calendar events sync with Google. Notes, stars, and workspace preferences belong to this device. HCB planning fields such as priority, tags, and duration travel in a marked footer in Google task notes."}</p>
      </SettingsGroup>
      {browserStorage ? (
        <SettingsGroup title="Keeping your workspace">
          <p className="px-3 py-3 text-sm text-text-secondary">Return using the same site and browser profile. Clearing this site's browser data removes your workspace; private browsing keeps data only for that private session. Browser backup export and restore are not available in this release.</p>
        </SettingsGroup>
      ) : (
      <SettingsGroup title="Local backups">
        <p className="px-3 py-3 text-sm text-text-secondary">Backups contain local notes, settings, and cached Google data. Google sign-in credentials are excluded. Export a copy to another drive to protect against loss of this device.</p>
        <SettingsSwitch checked={settings.dailyLocalBackupEnabled} label="Daily local backup" description="Creates a snapshot while the app is open, once every 24 hours." onChange={(checked) => updateSettings({ dailyLocalBackupEnabled: checked })} />
        <SettingsControlRow label="Keep backups">
          <Input aria-label="Keep backups" className="w-24" type="number" min={1} max={365} value={settings.localBackupRetentionCount} onChange={(event) => updateSettings({ localBackupRetentionCount: Math.max(1, Math.min(365, Number(event.currentTarget.value) || 14)) })} />
        </SettingsControlRow>
        <SettingsControlRow label="Last successful backup" description={settings.lastLocalBackupAt ? new Date(settings.lastLocalBackupAt).toLocaleString() : "No backup yet"}>
          <Button disabled={pending} onClick={() => runAction("backupNow")} variant="secondary"><Archive size={14} />Back up now</Button>
        </SettingsControlRow>
        <SettingsControlRow label="Save a copy elsewhere">
          <Button disabled={pending} onClick={() => runAction("exportBackup")} variant="secondary"><Download size={14} />Export backup</Button>
        </SettingsControlRow>
        <SettingsControlRow label="Saved snapshots">
          <Button disabled={pending || !settings.lastLocalBackupAt} onClick={() => runAction("openBackupsFolder")} variant="secondary"><FolderOpen size={14} />Open backup folder</Button>
        </SettingsControlRow>
        <SettingsControlRow label="Restore local notes" description="Choose a backup to restore its notes and note lists. Matching notes are replaced; other notes remain. Your current data is backed up first. Google data and pending sync changes are preserved.">
          <Button disabled={pending} onClick={() => runAction("restoreLocalNotes")} variant="secondary"><RotateCcw size={14} />Restore notes…</Button>
        </SettingsControlRow>
      </SettingsGroup>
      )}
    </div>
  );
}
