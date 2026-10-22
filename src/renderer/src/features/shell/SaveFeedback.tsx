import { useEffect, useState } from "react";

export function showSaveFeedback(message: string): void {
  window.dispatchEvent(new CustomEvent("hcb:save-feedback", { detail: message }));
}

export function SaveFeedback(): JSX.Element {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      clearTimeout(timer);
      setMessage((event as CustomEvent<string>).detail);
      timer = setTimeout(() => setMessage(""), 6000);
    };
    window.addEventListener("hcb:save-feedback", receive);
    return () => { clearTimeout(timer); window.removeEventListener("hcb:save-feedback", receive); };
  }, []);
  return <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[70] max-w-[80vw] -translate-x-1/2">{message ? <p className="rounded-lg border border-border bg-bg-primary px-4 py-3 text-sm text-text-primary shadow-lg">{message}</p> : null}</div>;
}
