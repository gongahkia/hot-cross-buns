import { ModalDialog } from "@/components/ModalDialog";
import { formatBinding, keybindingLabels } from "@/features/keybindings";
import type { WorkspaceKeybindings } from "@/types";

export function TutorialDialog({ keybindings, close }: { readonly keybindings: WorkspaceKeybindings; close(): void }): React.JSX.Element {
  return <ModalDialog className="tutorial-dialog" labelledBy="tutorial-heading" onClose={close}>
    <div className="panel-heading"><div><p className="eyebrow">A short orientation</p><h2 id="tutorial-heading">Hot Cross Buns tutorial</h2></div><button type="button" onClick={close}>Close</button></div>
    <section><h3>Get around</h3><dl className="shortcut-list">{(Object.keys(keybindingLabels) as Array<keyof WorkspaceKeybindings>).map((key) => <div key={key}><dt>{keybindingLabels[key]}</dt><dd><kbd>{formatBinding(keybindings[key])}</kbd></dd></div>)}</dl></section>
    <section><h3>Find anything</h3><p>Search is title-first. Enter a task, event, calendar, or command name and use the arrow keys and Enter to choose a result.</p><details><summary>Advanced search filters</summary><p>Use <code>type:task</code>, <code>due:today</code>, <code>completed:false</code>, <code>date:2026-08-01..2026-08-31</code>, or <code>in:&quot;Primary&quot;</code>. <code>list:</code>, <code>priority:</code>, <code>status:</code>, <code>start:</code>, <code>source:google</code>, and <code>notes:</code>/<code>body:</code> are also available.</p></details></section>
    <section><h3>Create and manage</h3><p>Add a task from Tasks. Calendar provides New event, Find time, and Manage calendars. <kbd>{formatBinding(keybindings.quickCapture)}</kbd> opens Quick capture to interpret a short task or event note before saving it. Sync and Refresh all Tasks are in Settings.</p></section>
    <section><h3>Open before editing</h3><p>Select a task or event to inspect its details first. Edit, duplicate, delete, and link actions are kept in that detail view so the calendar and task list stay fast to scan.</p></section>
  </ModalDialog>;
}
