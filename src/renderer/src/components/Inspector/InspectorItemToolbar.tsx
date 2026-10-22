import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Copy, Files, MoreHorizontal, Scissors, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

export type InspectorEntryKind = "event" | "task" | "birthday" | "note";
const kinds: InspectorEntryKind[] = ["event", "task", "birthday", "note"];
const label = (kind: InspectorEntryKind) => kind[0].toUpperCase() + kind.slice(1);

function menuKeys(event: KeyboardEvent<HTMLDivElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  event.preventDefault();
  items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}

export function InspectorItemToolbar({ kind, onKindChange, onCopy, onDuplicate, onDelete, persisted = true, busy = false }: {
  kind: InspectorEntryKind;
  onKindChange: (kind: InspectorEntryKind) => void | Promise<void>;
  onCopy: () => Promise<boolean>;
  onDuplicate: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  persisted?: boolean;
  busy?: boolean;
}) {
  const [typeOpen, setTypeOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  return <div className="inspector-item-toolbar">
    <Popover.Root open={typeOpen} onOpenChange={setTypeOpen}>
      <Popover.Trigger className="inspector-type-trigger" aria-label="Item type" aria-busy={busy}>{label(kind)}<ChevronDown size={13} /></Popover.Trigger>
      <Popover.Portal><Popover.Content className="inspector-item-menu" onKeyDown={menuKeys} align="start" sideOffset={6} aria-label="Item types" role="menu">
        {kinds.map((item) => <button key={item} role="menuitemradio" aria-checked={kind === item} onClick={() => { setTypeOpen(false); if (item !== kind) void onKindChange(item); }} type="button">
          <Check size={14} style={{ visibility: kind === item ? "visible" : "hidden" }} />{label(item)}
        </button>)}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <Popover.Root open={actionsOpen} onOpenChange={setActionsOpen}>
      <Popover.Trigger className="inspector-actions-trigger" aria-label="Item actions" aria-busy={busy}><MoreHorizontal size={17} /></Popover.Trigger>
      <Popover.Portal><Popover.Content className="inspector-item-menu" onKeyDown={menuKeys} align="end" sideOffset={6} role="menu" aria-label="Item actions">
        <button role="menuitem" disabled={!persisted} onClick={async () => { setActionsOpen(false); if (await onCopy()) await onDelete(); }} type="button"><Scissors size={14} />Cut</button>
        <button role="menuitem" onClick={() => { setActionsOpen(false); void onCopy(); }} type="button"><Copy size={14} />Copy</button>
        <button role="menuitem" onClick={() => { setActionsOpen(false); void onDuplicate(); }} type="button"><Files size={14} />Duplicate</button>
        <div className="inspector-menu-separator" role="separator" />
        <button role="menuitem" className="inspector-menu-delete" onClick={() => { setActionsOpen(false); void onDelete(); }} type="button"><Trash2 size={14} />{persisted ? "Delete" : "Discard draft"}</button>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}

export async function copyInspectorText(title: string, body = ""): Promise<boolean> {
  try {
    const text = [title, body].filter(Boolean).join("\n\n");
    const result = await window.hcb?.native.writeClipboardText({ text });
    if (!result?.ok) throw new Error("Clipboard is unavailable.");
    return true;
  } catch {
    window.alert("Could not copy this item. It has not been removed.");
    return false;
  }
}
