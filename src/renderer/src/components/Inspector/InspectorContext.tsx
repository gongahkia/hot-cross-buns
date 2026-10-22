import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from "react";
import type { ReactNode, RefObject } from "react";

export type InspectorItemKind =
  | "task"
  | "event"
  | "note"
  | "settings"
  | "diagnostics";

/**
 * A narrowly-scoped state source for inspector chrome that changes while an
 * editor is open. Keeping this outside the inspector context prevents a local
 * field edit from rerendering the workspace behind the dialog.
 */
export interface InspectorDirtyState {
  getSnapshot: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export interface InspectorItem {
  kind: InspectorItemKind;
  id: string; // stable id for the underlying record. "new" allowed for create flows
  ownerId?: string;
  title: string;
  subtitle?: string;
  body: ReactNode;
  hideHeader?: boolean; // body owns title/close affordance
  returnFocus?: RefObject<HTMLElement> | null; // restored on close
  dirty?: boolean; // whether body holds unsaved edits
  dirtyState?: InspectorDirtyState; // optional live dirty state for inspector chrome
  onConfirmClose?: () => Promise<boolean> | boolean; // return false to keep open
  actions?: ReactNode; // footer actions
}

interface InspectorContextValue {
  current: InspectorItem | null;
  open: (item: InspectorItem) => void;
  close: () => Promise<boolean>;
  update: (patch: Partial<Pick<InspectorItem, "title" | "subtitle" | "dirty" | "body" | "actions" | "hideHeader">>) => void;
  isOpen: boolean;
}

const InspectorReactContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { children: ReactNode }): JSX.Element {
  const [current, setCurrent] = useState<InspectorItem | null>(null);
  const currentRef = useRef<InspectorItem | null>(null);
  currentRef.current = current;

  const transition = useRef(0);
  const open = useCallback((item: InspectorItem): void => {
    const generation = ++transition.current;
    const active = currentRef.current;
    const returnFocus = active?.returnFocus !== undefined ? active.returnFocus : document.activeElement instanceof HTMLElement ? { current: document.activeElement } : null;
    const nextItem = item.returnFocus === undefined ? { ...item, returnFocus } : item;
    const commit = () => {
      if (transition.current !== generation) return;
      currentRef.current = nextItem;
      setCurrent(nextItem);
    };
    if (active?.onConfirmClose && (active.id !== item.id || active.kind !== item.kind)) {
      void Promise.resolve(active.onConfirmClose()).then((allowed) => { if (allowed) commit(); }).catch(() => undefined);
    } else commit();
  }, []);

  const close = useCallback(async (): Promise<boolean> => {
    const active = currentRef.current;
    const generation = ++transition.current;

    if (active?.onConfirmClose) {
      const allow = await active.onConfirmClose();
      if (!allow) {
        return false;
      }
    }

    // Chrome updates during an awaited save do not replace the selected item.
    // Only a newer open/close transition supersedes this close request.
    if (transition.current !== generation) return false;
    currentRef.current = null;
    setCurrent(null);
    queueMicrotask(() => active?.returnFocus?.current?.focus());
    return true;
  }, []);

  const update = useCallback<InspectorContextValue["update"]>((patch) => {
    setCurrent((existing) => (existing ? { ...existing, ...patch } : existing));
  }, []);

  const value = useMemo<InspectorContextValue>(
    () => ({ current, open, close, update, isOpen: current !== null }),
    [current, open, close, update]
  );

  return <InspectorReactContext.Provider value={value}>{children}</InspectorReactContext.Provider>;
}

export function useInspector(): InspectorContextValue {
  const value = useContext(InspectorReactContext);
  if (!value) {
    throw new Error("useInspector requires InspectorProvider");
  }
  return value;
}
