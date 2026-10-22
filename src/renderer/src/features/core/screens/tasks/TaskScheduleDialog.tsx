import { Select, SelectItem } from "@renderer/components/Select";
import { DateTimeField } from "@renderer/components/DateTimeField";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { Button, IconButton, Input } from "../../../../components/primitives";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import type { TaskViewModel } from "../../coreViewModels";
import { calendarDateTimeLocalInputToIso, calendarDateTimeLocalInputValue } from "../calendar/calendarDateUtils";

export function TaskScheduleDialog({ task, onClose }: { task: TaskViewModel; onClose: () => void }): JSX.Element {
  const source = useCoreViewModelSource();
  const existing = source.scheduledTaskBlocks.find((block) => block.taskId === task.id);
  const timeZone = source.settings.defaultTimeZone;
  const [calendarId, setCalendarId] = useState(existing?.calendarId ?? source.calendarSources.find((calendar) => calendar.selected)?.id ?? source.calendarSources[0]?.id ?? "");
  const [start, setStart] = useState(() => calendarDateTimeLocalInputValue(existing?.startsAt ?? new Date(Math.ceil((Date.now() + 60_000) / 1800_000) * 1800_000).toISOString(), timeZone));
  const [duration, setDuration] = useState(() => existing ? Math.round((Date.parse(existing.endsAt) - Date.parse(existing.startsAt)) / 60_000) : task.durationMinutes ?? 30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (pending || !calendarId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || !Number.isInteger(duration) || duration < 5 || duration > 1440) return;
    setPending(true);
    setError(null);
    try {
      const startsAt = calendarDateTimeLocalInputToIso(start, timeZone);
      const request = { calendarId, startsAt, durationMinutes: duration };
      const saved = existing
        ? await source.moveScheduledTaskBlock({ id: existing.id, ...request })
        : await source.scheduleTaskBlock({ taskId: task.id, ...request });
      if (saved) onClose();
      else setError("The Calendar block could not be saved. Check the selected calendar and try again.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Calendar block could not be saved.");
    } finally { setPending(false); }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] grid w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-hcbLg border border-border bg-bg-primary p-5 shadow-hcbLg" onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}>
          <div className="flex items-center gap-2">
            <CalendarClock size={18} />
            <Dialog.Title className="min-w-0 flex-1 font-semibold">{existing ? "Reschedule task" : "Schedule task"}</Dialog.Title>
            <IconButton icon={X} label="Cancel task scheduling" disabled={pending} onClick={onClose} variant="ghost" />
          </div>
          <Dialog.Description className="text-sm text-text-secondary">Create a linked Calendar event for “{task.title}”. Its Google Tasks due date stays separate. Choose a time here, or use Calendar → Smart schedule to find free time automatically.</Dialog.Description>
          <label className="grid gap-1 text-sm">Calendar
            <Select aria-label="Schedule calendar" className="h-9 rounded-hcbMd border border-border bg-surface-0 px-2" value={calendarId} disabled={pending} onValueChange={(value) => setCalendarId(value)}>
              {source.calendarSources.map((calendar) => <SelectItem key={calendar.id} value={calendar.id}>{calendar.title}{calendar.accountId === "local" ? " (this device)" : ""}</SelectItem>)}
            </Select>
          </label>
          <label className="grid gap-1 text-sm">Start ({timeZone})
            <DateTimeField aria-label="Schedule start" type="datetime-local" value={start} disabled={pending} onValueChange={(value) => setStart(value)} />
          </label>
          <label className="grid gap-1 text-sm">Duration (minutes)
            <Input aria-label="Schedule duration" type="number" min={5} max={1440} step={5} value={duration} disabled={pending} onChange={(event) => setDuration(Number(event.currentTarget.value))} />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={pending} variant="ghost">Cancel</Button>
            <Button onClick={() => void save()} disabled={pending || !calendarId || !start || !Number.isInteger(duration) || duration < 5 || duration > 1440} variant="primary">{pending ? "Saving…" : existing ? "Move Calendar block" : "Create Calendar block"}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
