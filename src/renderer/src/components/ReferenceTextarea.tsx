import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { KeyboardEvent, Ref, TextareaHTMLAttributes } from "react";
import { FileUp, FolderSearch, Link2, Search, X } from "lucide-react";
import type { GoogleStatusResponse } from "@shared/ipc/contracts";
import { googleScopes, hasGoogleScope } from "../googleCapabilities";
import { EmojiTextarea } from "./EmojiTextField";
import { Button, cx } from "./primitives";

type PickerSource = "all" | "drive" | "hcb";
type ReferenceKind = "event" | "note" | "task";

interface ReferenceItem {
  fileId?: string;
  fileUrl?: string;
  id: string;
  kind?: ReferenceKind;
  label: string;
  source: "drive" | "hcb";
  subtitle?: string;
}

interface QueryRange {
  end: number;
  start: number;
}

const maxRecentReferences = 12;

function setRef<T>(node: T, ref: Ref<T>): void {
  if (typeof ref === "function") {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
}

function atQuery(value: string, cursor: number): { query: string; range: QueryRange } | null {
  const before = value.slice(0, cursor);
  const match = /(^|\s)@([^\s@]{0,80})$/.exec(before);
  if (!match || match.index < 0) return null;
  return {
    query: match[2].toLowerCase(),
    range: { end: cursor, start: match.index + match[1].length }
  };
}

function referenceKind(domain: unknown): ReferenceKind | null {
  if (domain === "tasks") return "task";
  if (domain === "calendar") return "event";
  if (domain === "notes") return "note";
  return null;
}

function matches(item: ReferenceItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || `${item.label} ${item.subtitle ?? ""}`.toLowerCase().includes(normalized);
}

function distinct(items: ReferenceItem[]): ReferenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.source === "drive" ? item.fileUrl ?? item.id : `${item.kind}:${item.id}`}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recentReferences(value: unknown): ReferenceItem[] {
  if (!Array.isArray(value)) return [];
  return distinct(value.flatMap((entry): ReferenceItem[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (item.source === "drive" && typeof item.id === "string" && typeof item.label === "string" && typeof item.fileUrl === "string") {
      return [{ source: "drive", id: item.id, fileId: typeof item.fileId === "string" ? item.fileId : undefined, fileUrl: item.fileUrl, label: item.label, subtitle: typeof item.subtitle === "string" ? item.subtitle : "Drive file" }];
    }
    const kind = referenceKind(item.kind === "task" ? "tasks" : item.kind === "event" ? "calendar" : item.kind === "note" ? "notes" : null);
    if (item.source === "hcb" && kind && typeof item.id === "string" && typeof item.label === "string") {
      return [{ source: "hcb", id: item.id, kind, label: item.label, subtitle: `HCB ${kind}` }];
    }
    return [];
  }));
}

function markdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
}

function markerFor(item: ReferenceItem): string {
  const label = markdownLabel(item.label);
  if (item.source === "drive" && item.fileUrl) return `[${label}](<${item.fileUrl.replace(/>/g, "%3E")}>)`;
  if (item.source === "hcb" && item.kind) return `[[hcb:${item.kind}:${item.id}|${label}]]`;
  return item.label;
}

function toDriveItem(value: unknown): ReferenceItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.fileUrl !== "string" || typeof item.title !== "string") return null;
  return {
    source: "drive",
    id: typeof item.fileId === "string" ? item.fileId : item.fileUrl,
    fileId: typeof item.fileId === "string" ? item.fileId : undefined,
    fileUrl: item.fileUrl,
    label: item.title,
    subtitle: item.mimeType === "string" ? item.mimeType : "Drive file"
  };
}

function toHcbItem(value: unknown): ReferenceItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const kind = referenceKind(item.domain);
  if (!kind || typeof item.id !== "string" || typeof item.title !== "string") return null;
  return { source: "hcb", id: item.id, kind, label: item.title, subtitle: `HCB ${kind}` };
}

function driveCapabilities(status: GoogleStatusResponse, accountId?: string): { canSearch: boolean; canUpload: boolean } {
  return {
    canSearch: hasGoogleScope(status, accountId, googleScopes.driveSearch),
    canUpload: hasGoogleScope(status, accountId, googleScopes.driveUpload)
  };
}

export const ReferenceTextarea = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
  accountId?: string;
  onValueChange: (value: string) => void;
}>(
  function ReferenceTextarea({ accountId, className, onKeyDown, onSelect, onValueChange, value = "", ...props }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [driveItems, setDriveItems] = useState<ReferenceItem[]>([]);
    const [canSearchDrive, setCanSearchDrive] = useState(false);
    const [canUploadDrive, setCanUploadDrive] = useState(false);
    const [hcbItems, setHcbItems] = useState<ReferenceItem[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [mode, setMode] = useState<PickerSource>("all");
    const [pickerQuery, setPickerQuery] = useState("");
    const [range, setRange] = useState<QueryRange | null>(null);
    const [recent, setRecent] = useState<ReferenceItem[]>([]);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
      let cancelled = false;
      void window.hcb?.settings.get().then((result) => {
        if (!cancelled && result?.ok) setRecent(recentReferences(result.data.referenceRecents));
      });
      return () => { cancelled = true; };
    }, []);

    useEffect(() => {
      let cancelled = false;
      void window.hcb?.google.status().then((result) => {
        if (cancelled || !result?.ok) return;
        const capabilities = driveCapabilities(result.data, accountId);
        setCanSearchDrive(capabilities.canSearch);
        setCanUploadDrive(capabilities.canUpload);
      });
      return () => { cancelled = true; };
    }, [accountId]);

    useEffect(() => {
      if (!canSearchDrive && mode === "drive") setMode("all");
    }, [canSearchDrive, mode]);

    useEffect(() => {
      if (!isOpen) return;
      let cancelled = false;
      const timer = window.setTimeout(() => {
        if (canSearchDrive && (mode === "all" || mode === "drive")) {
          void window.hcb?.google.searchDriveFiles({ accountId, query: pickerQuery }).then((result) => {
            if (cancelled) return;
            if (!result?.ok) {
              setDriveItems([]);
              setMessage(result?.error.message ?? "Unable to search Drive.");
              return;
            }
            setDriveItems(distinct((result.data.items ?? []).map(toDriveItem).filter((item): item is ReferenceItem => item !== null)));
            setMessage(null);
          });
        } else {
          setDriveItems([]);
        }
        if (mode === "all" || mode === "hcb") {
          void window.hcb?.search.query({ query: pickerQuery, limit: 8 }).then((result) => {
            if (cancelled) return;
            if (!result?.ok) {
              setHcbItems([]);
              setMessage(result?.error.message ?? "Unable to search Hot Cross Buns items.");
              return;
            }
            setHcbItems(distinct((result.data.items ?? []).map(toHcbItem).filter((item): item is ReferenceItem => item !== null)));
          });
        } else {
          setHcbItems([]);
        }
      }, 160);
      return () => { cancelled = true; window.clearTimeout(timer); };
    }, [accountId, canSearchDrive, isOpen, mode, pickerQuery]);

    const recentItems = useMemo(
      () => recent.filter((item) => matches(item, pickerQuery) && (mode === "all" || item.source === mode) && (item.source !== "drive" || canSearchDrive)),
      [canSearchDrive, mode, pickerQuery, recent]
    );
    const freshDriveItems = useMemo(
      () => driveItems.filter((item) => !recentItems.some((recentItem) => recentItem.source === "drive" && recentItem.fileUrl === item.fileUrl)),
      [driveItems, recentItems]
    );
    const freshHcbItems = useMemo(
      () => hcbItems.filter((item) => !recentItems.some((recentItem) => recentItem.source === "hcb" && recentItem.kind === item.kind && recentItem.id === item.id)),
      [hcbItems, recentItems]
    );
    const choices = useMemo(() => [...recentItems, ...freshDriveItems, ...freshHcbItems], [freshDriveItems, freshHcbItems, recentItems]);
    const sourceTabs: PickerSource[] = canSearchDrive ? ["all", "drive", "hcb"] : ["all", "hcb"];

    useEffect(() => { setActiveIndex(0); }, [isOpen, mode, pickerQuery]);

    function openPicker(nextMode: PickerSource, focusSearch = true): void {
      const element = textareaRef.current;
      const cursor = element?.selectionStart ?? String(value).length;
      setRange({ start: element?.selectionStart ?? cursor, end: element?.selectionEnd ?? cursor });
      setPickerQuery("");
      setMode(nextMode);
      setMessage(null);
      setIsOpen(true);
      if (focusSearch) window.setTimeout(() => searchRef.current?.focus(), 0);
    }

    function refreshAtQuery(nextValue: string, cursor: number): void {
      const query = atQuery(nextValue, cursor);
      if (!query) {
        if (isOpen && range && range.start < range.end) setIsOpen(false);
        return;
      }
      setRange(query.range);
      setPickerQuery(query.query);
      setMode("all");
      setMessage(null);
      setIsOpen(true);
    }

    function handleValueChange(nextValue: string): void {
      onValueChange(nextValue);
      window.requestAnimationFrame(() => {
        const cursor = textareaRef.current?.selectionStart ?? nextValue.length;
        refreshAtQuery(nextValue, cursor);
      });
    }

    function remember(item: ReferenceItem): void {
      const next = distinct([item, ...recent]).slice(0, maxRecentReferences);
      setRecent(next);
      void window.hcb?.settings.update({ referenceRecents: next.map((entry) => ({
        source: entry.source,
        id: entry.id,
        ...(entry.fileId ? { fileId: entry.fileId } : {}),
        ...(entry.fileUrl ? { fileUrl: entry.fileUrl } : {}),
        ...(entry.kind ? { kind: entry.kind } : {}),
        label: entry.label,
        subtitle: entry.subtitle
      })) });
    }

    function choose(item: ReferenceItem): void {
      const selection = range ?? { start: textareaRef.current?.selectionStart ?? String(value).length, end: textareaRef.current?.selectionEnd ?? String(value).length };
      const marker = markerFor(item);
      const nextValue = `${String(value).slice(0, selection.start)}${marker}${String(value).slice(selection.end)}`;
      const nextCursor = selection.start + marker.length;
      onValueChange(nextValue);
      remember(item);
      setIsOpen(false);
      setMessage(null);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    }

    async function uploadFromMac(): Promise<void> {
      if (!canUploadDrive) return;
      setUploading(true);
      setMessage("Choose a file to upload privately to Drive…");
      const result = await window.hcb?.google.pickAndUploadDriveFile({ accountId });
      setUploading(false);
      if (!result?.ok) {
        setMessage(result?.error.message ?? "The file could not be uploaded to Drive.");
        return;
      }
      if (result.data.cancelled) {
        setMessage(null);
        return;
      }
      const item = toDriveItem(result.data.item);
      if (!item) {
        setMessage("Drive did not return a usable link for that file.");
        return;
      }
      choose(item);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
      if (isOpen && choices.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((current) => (current + 1) % choices.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((current) => (current - 1 + choices.length) % choices.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          choose(choices[activeIndex] ?? choices[0]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setIsOpen(false);
          return;
        }
      }
      onKeyDown?.(event);
    }

    function renderItem(item: ReferenceItem, index: number): JSX.Element {
      return (
        <button
          aria-selected={index === activeIndex}
          className={cx(
            "grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-hcbSm px-2 py-1.5 text-left text-[var(--text-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            index === activeIndex ? "bg-bg-tertiary text-text-primary" : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
          )}
          key={`${item.source}-${item.id}-${item.fileUrl ?? item.kind ?? ""}`}
          onClick={() => choose(item)}
          onMouseEnter={() => setActiveIndex(index)}
          role="option"
          type="button"
        >
          {item.source === "drive" ? <FolderSearch aria-hidden="true" size={14} /> : <Link2 aria-hidden="true" size={14} />}
          <span className="min-w-0"><span className="block truncate font-medium">{item.label}</span><span className="block truncate text-[var(--text-xs)] text-text-muted">{item.subtitle}</span></span>
        </button>
      );
    }

    let choiceIndex = 0;
    const renderGroup = (title: string, items: ReferenceItem[]): JSX.Element | null => {
      if (items.length === 0) return null;
      const start = choiceIndex;
      choiceIndex += items.length;
      return <div className="grid gap-0.5" key={title}><div className="px-2 pt-2 text-[var(--text-xs)] font-semibold uppercase tracking-wide text-text-muted">{title}</div>{items.map((item, index) => renderItem(item, start + index))}</div>;
    };

    return (
      <div className="relative grid min-w-0 gap-2">
        <EmojiTextarea
          className={className}
          onKeyDown={handleKeyDown}
          onSelect={(event) => {
            onSelect?.(event);
            refreshAtQuery(String(value), event.currentTarget.selectionStart ?? String(value).length);
          }}
          onValueChange={handleValueChange}
          ref={(node) => { textareaRef.current = node; setRef(node, ref); }}
          value={value}
          {...props}
        />
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Insert reference">
          {canSearchDrive ? <Button onClick={() => openPicker("drive")} size="sm" type="button" variant="secondary"><FolderSearch aria-hidden="true" size={14} />Drive</Button> : null}
          <Button onClick={() => openPicker("hcb")} size="sm" type="button" variant="secondary"><Link2 aria-hidden="true" size={14} />HCB item</Button>
          {canUploadDrive ? <Button disabled={uploading} onClick={() => void uploadFromMac()} size="sm" type="button" variant="secondary"><FileUp aria-hidden="true" size={14} />Upload file</Button> : null}
          <span className="text-[var(--text-xs)] text-text-muted">Type <kbd className="rounded border border-border bg-surface-0 px-1 font-mono">@</kbd> to insert a reference.</span>
        </div>
        {isOpen ? (
          <div className="absolute inset-x-0 top-[calc(100%+4px)] z-[1002] grid max-h-[min(28rem,60vh)] overflow-auto rounded-hcbMd border border-border bg-surface-0 p-1 shadow-xl" role="dialog" aria-label="Insert reference">
            <div className="flex items-center gap-1 border-b border-border p-1">
              <Search aria-hidden="true" className="ml-1 text-text-muted" size={14} />
              <input aria-label="Search references" className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[var(--text-sm)] text-text-primary outline-none placeholder:text-text-muted" onChange={(event) => setPickerQuery(event.currentTarget.value)} placeholder={canSearchDrive ? "Search Drive or Hot Cross Buns" : "Search Hot Cross Buns"} ref={searchRef} value={pickerQuery} />
              <button aria-label="Close reference picker" className="flex size-8 items-center justify-center rounded-hcbSm text-text-muted hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setIsOpen(false)} type="button"><X aria-hidden="true" size={14} /></button>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-border p-1">
              {sourceTabs.map((source) => <button aria-pressed={mode === source} className={cx("rounded-hcbSm px-2 py-1 text-[var(--text-xs)] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", mode === source ? "bg-bg-tertiary text-text-primary" : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary")} key={source} onClick={() => setMode(source)} type="button">{source === "all" ? "All" : source === "drive" ? "Drive" : "HCB items"}</button>)}
              {canUploadDrive ? <button className="ml-auto inline-flex items-center gap-1 rounded-hcbSm px-2 py-1 text-[var(--text-xs)] font-semibold text-accent hover:bg-bg-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" disabled={uploading} onClick={() => void uploadFromMac()} type="button"><FileUp aria-hidden="true" size={13} />Upload from Mac</button> : null}
            </div>
            <div className="grid p-1" role="listbox" aria-label="Reference results">
              {renderGroup("Recently used", recentItems)}
              {renderGroup("Drive", freshDriveItems)}
              {renderGroup("Hot Cross Buns", freshHcbItems)}
              {choices.length === 0 && !message ? <p className="px-2 py-4 text-center text-[var(--text-sm)] text-text-muted">No references match that search.</p> : null}
              {message ? <div className="grid gap-1 px-2 py-3 text-[var(--text-xs)] text-warning" role="status"><span>{message}</span></div> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
);
