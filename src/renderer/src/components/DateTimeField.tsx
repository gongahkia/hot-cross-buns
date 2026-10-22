import * as Popover from "@radix-ui/react-popover";
import { addDays, addMonths, format, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { Select, SelectItem } from "./Select";

type FieldType = "date" | "datetime-local" | "time";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  type?: FieldType;
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  label?: string;
};
const dayKey = (date: Date) => format(date, "yyyy-MM-dd");
export function validDateTimeValue(value: string, type: FieldType): boolean {
  if (!value) return true;
  const date = type === "time" ? "2000-01-01" : value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || dayKey(parsed) !== date) return false;
  if (type === "date") return value.length === 10;
  const time = type === "time" ? value : value.slice(11);
  return (type === "time" || value[10] === "T") && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time);
}

/** A renderer-owned picker: no OS popup window, including on Electron/WSLg. */
export const DateTimeField = forwardRef<HTMLInputElement, Props>(function DateTimeField(
  { type = "date", value, onValueChange, className, min, max, disabled, readOnly, label, onBlur, ...props }, ref
) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [yearText, setYearText] = useState(() => String(new Date().getFullYear()));
  const [focusedDay, setFocusedDay] = useState(() => dayKey(new Date()));
  const grid = useRef<HTMLDivElement>(null);
  const keyboardFocus = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!);
  useEffect(() => setText(value), [value]);
  useEffect(() => setYearText(String(month.getFullYear())), [month]);
  useLayoutEffect(() => {
    if (!open || !keyboardFocus.current) return;
    keyboardFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus();
  }, [focusedDay, month, open]);
  const inBounds = (next: string) => (!min || next >= min) && (!max || next <= max);
  const valid = validDateTimeValue(text, type) && (!text || inBounds(text));
  const name = props["aria-label"] ?? label ?? (type === "time" ? "Time" : "Date");
  const placeholder = type === "date" ? "YYYY-MM-DD" : type === "time" ? "HH:mm" : "YYYY-MM-DDTHH:mm";
  function change(next: string, commit = false) {
    setText(next);
    if (validDateTimeValue(next, type) && (!next || inBounds(next))) {
      onValueChange(next);
      if (commit) input.current?.dispatchEvent(new Event("hcb:field-commit", { bubbles: true }));
    }
  }
  function openPicker(next: boolean) {
    if (next) {
      const selected = type !== "time" && validDateTimeValue(value, type) && value ? new Date(`${value.slice(0, 10)}T12:00:00`) : new Date();
      setMonth(startOfMonth(selected)); setFocusedDay(dayKey(selected));
    }
    setOpen(next);
  }
  const selectedDate = value.slice(0, 10);
  const time = (type === "time" ? value : value.slice(11, 16)) || "09:00";
  function chooseDay(key: string) {
    change(type === "date" ? key : `${key}T${time}`, true);
    if (type === "date") setOpen(false);
  }
  const start = startOfWeek(startOfMonth(month));
  const field = <Popover.Root open={open} onOpenChange={openPicker}>
    <div className={cn("date-time-field", className)} data-invalid={!valid || undefined}>
      <input {...props} aria-label={name} ref={input} type="text" value={text} placeholder={props.placeholder ?? placeholder} disabled={disabled} readOnly={readOnly} aria-invalid={!valid || props["aria-invalid"]} spellCheck={false}
        onChange={(event) => change(event.target.value)} onBlur={onBlur}
        onKeyDown={(event) => { props.onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === "ArrowDown") { event.preventDefault(); openPicker(true); } }} />
      <Popover.Trigger asChild><button type="button" disabled={disabled || readOnly} aria-label={`Choose ${name.toLowerCase()}`} title={`Choose ${name.toLowerCase()}`}>
        {type === "time" ? <Clock size={15} /> : <CalendarDays size={15} />}
      </button></Popover.Trigger>
    </div>
    <Popover.Portal><Popover.Content className="date-picker" align="end" sideOffset={6} collisionPadding={8} aria-label={`${name} picker`} onEscapeKeyDown={(event) => event.stopPropagation()}
      onOpenAutoFocus={(event) => { if (type !== "time") { event.preventDefault(); grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus(); } }}>
      {type !== "time" ? <>
        <div className="date-picker-heading">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
          <Select aria-label="Picker month" value={month.getMonth()} onValueChange={(next) => setMonth(new Date(month.getFullYear(), Number(next), 1))}>
            {Array.from({ length: 12 }, (_, index) => <SelectItem key={index} value={index}>{format(new Date(2000, index, 1), "MMMM")}</SelectItem>)}
          </Select>
          <input type="number" aria-label="Picker year" min={100} max={9999} value={yearText} onChange={(event) => {
            setYearText(event.target.value);
            if (/^\d{4}$/.test(event.target.value)) setMonth(new Date(Number(event.target.value), month.getMonth(), 1));
          }} onBlur={() => {
            const year = Number(yearText);
            if (year >= 100 && year <= 9999) setMonth(new Date(year, month.getMonth(), 1));
            else setYearText(String(month.getFullYear()));
          }} />
          <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="date-picker-weekdays" aria-hidden="true">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}>{day}</span>)}</div>
        <div className="date-picker-grid" role="group" aria-label={format(month, "MMMM yyyy")} ref={grid}>
          {Array.from({ length: 42 }, (_, index) => {
            const day = addDays(start, index), key = dayKey(day);
            const blocked = Boolean((min && key < min.slice(0, 10)) || (max && key > max.slice(0, 10)));
            return <button type="button" key={key} data-date={key} data-outside={day.getMonth() !== month.getMonth() || undefined} aria-label={format(day, "EEEE, MMMM d, yyyy")} aria-pressed={key === selectedDate} aria-current={key === dayKey(new Date()) ? "date" : undefined} disabled={blocked}
              tabIndex={key === focusedDay || (focusedDay.slice(0, 7) !== dayKey(month).slice(0, 7) && day.getDate() === 1 && day.getMonth() === month.getMonth()) ? 0 : -1}
              onClick={() => chooseDay(key)} onKeyDown={(event) => {
                const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -day.getDay(), End: 6 - day.getDay() };
                const next = event.key === "PageUp" || event.key === "PageDown" ? addMonths(day, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)) : event.key in offsets ? addDays(day, offsets[event.key]) : null;
                if (!next) return;
                event.preventDefault(); keyboardFocus.current = true; setFocusedDay(dayKey(next)); setMonth(startOfMonth(next));
              }}>{day.getDate()}</button>;
          })}
        </div>
      </> : null}
      {type !== "date" ? <label className="date-picker-time">Time<Select aria-label="Picker time" value={time} onValueChange={(next) => change(type === "time" ? next : `${selectedDate || dayKey(new Date())}T${next}`, true)}>
        {!/^(\d\d):(00|15|30|45)$/.test(time) ? <SelectItem value={time}>{time}</SelectItem> : null}
        {Array.from({ length: 96 }, (_, index) => { const next = `${String(Math.floor(index / 4)).padStart(2, "0")}:${String(index % 4 * 15).padStart(2, "0")}`; return <SelectItem key={next} value={next}>{next}</SelectItem>; })}
      </Select></label> : null}
      <div className="date-picker-footer">
        {type !== "time" ? <button type="button" disabled={!inBounds(type === "date" ? dayKey(new Date()) : `${dayKey(new Date())}T${time}`)} onClick={() => chooseDay(dayKey(new Date()))}>Today</button> : null}
        {!props.required ? <button type="button" onClick={() => { change("", true); setOpen(false); }}>Clear</button> : null}
        <Popover.Close asChild><button type="button">Close</button></Popover.Close>
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
  return <div className="date-time-control">{label ? <label><span>{label}</span>{field}</label> : field}{!valid ? <span className="date-time-error" role="status">Enter a valid {placeholder}{min ? ` from ${min}` : ""}{max ? ` through ${max}` : ""}.</span> : null}</div>;
});
