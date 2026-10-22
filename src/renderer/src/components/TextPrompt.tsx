import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button, Input } from "./primitives";

interface TextRequest { title: string; initialValue?: string; submitLabel?: string }
const Context = createContext<(request: TextRequest) => Promise<string | null>>(async () => null);

/** Electron deliberately does not implement window.prompt. */
export function TextPromptProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<TextRequest | null>(null);
  const [value, setValue] = useState("");
  const resolve = useRef<((value: string | null) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const finish = useCallback((result: string | null) => {
    resolve.current?.(result);
    resolve.current = null;
    setRequest(null);
  }, []);
  const prompt = useCallback((next: TextRequest) => new Promise<string | null>((done) => {
    resolve.current?.(null);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    resolve.current = done;
    setValue(next.initialValue ?? "");
    setRequest(next);
  }), []);
  useEffect(() => () => resolve.current?.(null), []);
  return <Context.Provider value={prompt}>
    {children}
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) finish(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-hcbLg border border-border bg-bg-primary p-5 shadow-xl" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
          <Dialog.Title className="mb-1 text-[var(--text-lg)] font-semibold">{request?.title}</Dialog.Title>
          <Dialog.Description className="mb-4 text-text-muted">Choose a name for this list.</Dialog.Description>
          <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) finish(value.trim()); }}>
            <Input label="List name" value={value} maxLength={500} onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.target.select()} autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => finish(null)} variant="ghost">Cancel</Button>
              <Button type="submit" disabled={!value.trim()} variant="primary">{request?.submitLabel ?? "Save"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </Context.Provider>;
}

export const useTextPrompt = () => useContext(Context);
