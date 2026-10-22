import * as Menu from "@radix-ui/react-dropdown-menu";
import { Copy, Files, Pencil, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { EventMenuContext, type CalendarMenuTarget } from "./calendarEventMenuContext";
import type { CalendarEventViewModel } from "../../coreViewModels";

export type CalendarEventAction = "copy" | "duplicate" | "delete";

/** A single menu per calendar, including items rendered in overflow portals. */
export function CalendarEventMenuProvider({ children, onOpen, onAction }: {
  children: ReactNode;
  onOpen: (event: CalendarEventViewModel) => void;
  onAction: (event: CalendarEventViewModel, action: CalendarEventAction) => void;
}) {
  const [target, setTarget] = useState<CalendarMenuTarget | null>(null);
  const [open, setOpen] = useState(false);
  const selected = useRef(false);
  const event = target?.event;
  const recurring = event && Boolean(event.originalStartAt || event.recurringEventId || event.recurrenceRule || event.recurrenceLines.length);
  const select = (action: "open" | CalendarEventAction) => {
    if (!event) return;
    selected.current = true; setOpen(false); target?.beforeAction?.();
    if (action === "open") onOpen(event); else onAction(event, action);
  };
  return <EventMenuContext.Provider value={(next) => { selected.current = false; setTarget(next); setOpen(true); }}>
    {children}
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild><span aria-hidden tabIndex={-1} style={{ position: "fixed", left: target?.x ?? 0, top: target?.y ?? 0, width: 1, height: 1, pointerEvents: "none" }} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className="calendar-menu calendar-event-menu" aria-label="Calendar item actions" align="start" sideOffset={2} collisionPadding={8}
        onCloseAutoFocus={(e) => { e.preventDefault(); if (!selected.current && target?.trigger.isConnected) target.trigger.focus({ preventScroll: true }); }}>
        <Menu.Label className="calendar-event-menu-title">{event?.title}</Menu.Label>
        <Menu.Item className="calendar-menu-item" onSelect={() => select("open")}><Pencil size={15} />{event?.sourceKind === "task" ? "Open task" : "Edit event"}</Menu.Item>
        {event?.sourceKind !== "task" ? <>
          <Menu.Item className="calendar-menu-item" onSelect={() => select("copy")}><Copy size={15} />Copy text</Menu.Item>
          <Menu.Item className="calendar-menu-item" onSelect={() => select("duplicate")}><Files size={15} />{recurring ? "Duplicate this occurrence" : "Duplicate event"}</Menu.Item>
          <Menu.Separator className="calendar-menu-separator" />
          <Menu.Item className="calendar-menu-item text-danger" onSelect={() => select("delete")}><Trash2 size={15} />Delete event{recurring ? "…" : ""}</Menu.Item>
        </> : null}
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </EventMenuContext.Provider>;
}
