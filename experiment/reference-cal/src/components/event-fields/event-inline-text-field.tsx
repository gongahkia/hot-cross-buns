"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { eventInlineTextClass } from "./event-field-editor";

interface EventInlineTextFieldProps {
  id: string;
  label: string;
  value?: string;
  placeholder: string;
  onChange: (value: string | undefined) => void;
  multiline?: boolean;
  trimOnBlur?: boolean;
  maxLength?: number;
  className?: string;
}

/** Shared title-style editing, autosave and cancellation in either event host. */
export function EventInlineTextField({
  id,
  label,
  value,
  placeholder,
  onChange,
  multiline = false,
  trimOnBlur = false,
  maxLength,
  className,
}: EventInlineTextFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const editorRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const originalValue = React.useRef(value);
  const cancelled = React.useRef(false);
  const restoreFocus = React.useRef(false);
  const blurFrame = React.useRef<number | null>(null);
  const setEditorRef = React.useCallback(
    (node: HTMLInputElement | HTMLTextAreaElement | null) => {
      editorRef.current = node;
    },
    [],
  );

  React.useEffect(() => {
    if (editing) editorRef.current?.focus({ preventScroll: true });
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  React.useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editing || !multiline || !editor) return;
    editor.style.height = "auto";
    const borderHeight = editor.offsetHeight - editor.clientHeight;
    editor.style.height = `${editor.scrollHeight + borderHeight}px`;
  }, [editing, draft, multiline]);

  React.useEffect(
    () => () => {
      if (blurFrame.current !== null) cancelAnimationFrame(blurFrame.current);
    },
    [],
  );

  const editorProps = {
    ref: setEditorRef,
    id,
    "aria-label": label,
    "data-inline-event-editor": label.toLowerCase(),
    value: draft,
    placeholder,
    maxLength,
    autoComplete: "off",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.target.value;
      setDraft(next);
      // Like the title, retain edits even if the event or its host is replaced.
      onChange(next);
    },
    onBlur: () => {
      if (trimOnBlur && !cancelled.current) {
        const trimmed = draft.trim();
        if (trimmed !== draft) {
          setDraft(trimmed);
          onChange(trimmed);
        }
      }
      if (blurFrame.current !== null) cancelAnimationFrame(blurFrame.current);
      // Let modal focus settle before replacing its previously focused editor.
      blurFrame.current = requestAnimationFrame(() => {
        blurFrame.current = null;
        if (
          restoreFocus.current ||
          document.activeElement !== editorRef.current
        )
          setEditing(false);
      });
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = true;
        if (draft !== (originalValue.current ?? ""))
          onChange(originalValue.current);
        setDraft(originalValue.current ?? "");
        restoreFocus.current = true;
        event.currentTarget.blur();
      } else if (
        event.key === "Enter" &&
        (!multiline || event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        restoreFocus.current = true;
        event.currentTarget.blur();
      }
    },
  };

  if (editing)
    return multiline ? (
      <textarea
        {...editorProps}
        rows={1}
        className={cn(
          eventInlineTextClass,
          "block h-auto min-h-8 max-h-[40dvh] resize-none overflow-y-auto [overflow-wrap:anywhere]",
          className,
        )}
      />
    ) : (
      <input
        {...editorProps}
        type="text"
        className={cn(eventInlineTextClass, "min-h-8 min-w-0", className)}
      />
    );

  return (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      aria-label={`Edit ${label.toLowerCase()}`}
      onClick={() => {
        originalValue.current = value;
        cancelled.current = false;
        restoreFocus.current = false;
        setDraft(value ?? "");
        setEditing(true);
      }}
      className={cn(
        eventInlineTextClass,
        "min-h-8 min-w-0 text-left whitespace-pre-wrap [overflow-wrap:anywhere]",
        !value && "text-foreground/65",
        className,
      )}
    >
      {value || placeholder}
    </button>
  );
}
