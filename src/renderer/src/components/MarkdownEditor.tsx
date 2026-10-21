import { lazy, Suspense } from "react";

export interface MarkdownEditorProps {
  "aria-label": string;
  value: string;
  onValueChange: (markdown: string) => void;
  accountId?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  showControls?: boolean;
}

const RichMarkdownEditor = lazy(() => import("./markdown/RichMarkdownEditor"));

/** All document fields use the same editor; keep ProseMirror off the startup path. */
export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
  return <Suspense fallback={<div className="min-h-24 rounded-hcbMd border border-border p-3 text-text-muted" role="status">Loading editor…</div>}>
    <RichMarkdownEditor {...props} />
  </Suspense>;
}
