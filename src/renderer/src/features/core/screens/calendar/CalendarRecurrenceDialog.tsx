import * as Dialog from "@radix-ui/react-dialog";
import type { CalendarEventCompletionScope } from "@shared/ipc/contracts";
import { Button } from "../../../../components/primitives";

export function CalendarRecurrenceDialog({ deleting = false, onChoose, onCancel }: {
  deleting?: boolean;
  onChoose: (scope: CalendarEventCompletionScope) => void;
  onCancel: () => void;
}) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg-primary/70" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] grid w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-hcbLg border border-border bg-bg-secondary p-4 shadow-xl"
        onEscapeKeyDown={(event) => event.stopPropagation()}>
        <Dialog.Title className="font-semibold">{deleting ? "Delete recurring event" : "Save recurring event"}</Dialog.Title>
        <Dialog.Description className="text-sm text-text-secondary">{deleting ? "Choose which events to delete." : "Choose where to apply these edits."}</Dialog.Description>
        {([ ["occurrence", "This occurrence"], ["following", "This and future occurrences"], ["series", "Entire series"] ] as const).filter(([scope]) => !deleting || scope !== "following").map(([scope, label]) =>
          <Button key={scope} onClick={() => onChoose(scope)} variant={deleting && scope === "series" ? "danger" : "secondary"}>{label}</Button>)}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
