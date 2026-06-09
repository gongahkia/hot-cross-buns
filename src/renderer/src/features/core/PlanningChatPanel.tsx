import { MessageSquare, Send, X } from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "@shared/ipc/contracts";
import { Button, IconButton } from "../../components/primitives";

export function PlanningChatPanel({ enabled }: { enabled: boolean }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  async function send(): Promise<void> {
    const message = draft.trim();
    if (!message || pending) {
      return;
    }
    setPending(true);
    setDraft("");
    const result = await window.hcb?.chat.send({
      ...(sessionId ? { sessionId } : {}),
      message
    });
    if (result?.ok) {
      setSessionId(result.data.session.id);
      setMessages((current) => [
        ...current,
        result.data.userMessage,
        result.data.assistantMessage
      ]);
    }
    setPending(false);
  }

  if (!enabled) {
    return null;
  }

  if (!open) {
    return (
      <Button className="fixed bottom-3 left-3 z-50" onClick={() => setOpen(true)} variant="secondary">
        <MessageSquare aria-hidden="true" size={14} />
        Chat
      </Button>
    );
  }

  return (
    <aside className="fixed bottom-3 left-3 z-50 grid h-[min(34rem,calc(100vh-1.5rem))] w-[min(28rem,calc(100vw-1.5rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-xl">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold text-text-primary">Planning chat</h2>
        <div className="flex-1" />
        <IconButton icon={X} label="Close planning chat" onClick={() => setOpen(false)} variant="ghost" />
      </div>
      <div className="grid content-start gap-2 overflow-auto p-3">
        {messages.length === 0 ? (
          <div className="text-[var(--text-sm)] text-text-muted">Ask a planning question.</div>
        ) : messages.map((message) => (
          <div
            className={message.role === "user" ? "justify-self-end rounded-hcbMd bg-accent px-3 py-2 text-bg-primary" : "rounded-hcbMd bg-bg-secondary px-3 py-2 text-text-primary"}
            key={message.id}
          >
            <div className="whitespace-pre-wrap text-[var(--text-sm)]">{message.content}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 border-t border-border p-3">
        <textarea
          aria-label="Planning chat message"
          className="min-h-20 resize-none rounded-hcbMd border border-border bg-bg-secondary px-3 py-2 text-[var(--text-sm)] text-text-primary outline-none focus:border-accent"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="What should I do next?"
          value={draft}
        />
        <Button disabled={pending || !draft.trim()} onClick={() => void send()} variant="primary">
          <Send aria-hidden="true" size={14} />
          Send
        </Button>
      </div>
    </aside>
  );
}
