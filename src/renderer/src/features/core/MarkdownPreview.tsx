import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState } from "../../components/states";
import { cx } from "../../components/primitives";

export interface MarkdownPreviewProps {
  ariaLabel?: string;
  body: string;
  className?: string;
  emptyDescription?: string;
  emptyTitle?: string;
  variant?: "card" | "plain";
}

function safeHref(href: string | undefined): string | undefined {
  const trimmed = href?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

export function MarkdownPreview({
  ariaLabel = "Markdown preview",
  body,
  className,
  emptyDescription = "This note has no body yet.",
  emptyTitle = "Empty note",
  variant = "card"
}: MarkdownPreviewProps): JSX.Element {
  const components: Components = {
    a({ children, href }) {
      const sanitizedHref = safeHref(href);

      return (
        <a
          className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          href={sanitizedHref}
          rel="noreferrer"
          target={sanitizedHref?.startsWith("#") ? undefined : "_blank"}
        >
          {children}
        </a>
      );
    },
    blockquote({ children }) {
      return (
        <blockquote className="border-l-2 border-accent pl-3 text-text-secondary">
          {children}
        </blockquote>
      );
    },
    code({ children, className: codeClassName }) {
      return (
        <code
          className={cx(
            "rounded-hcbSm border border-border bg-bg-tertiary px-1 py-0.5 font-mono text-[0.92em] text-text-primary",
            codeClassName
          )}
        >
          {children}
        </code>
      );
    },
    del({ children }) {
      return <del className="text-text-muted">{children}</del>;
    },
    h1({ children }) {
      return <h1 className="text-[var(--text-xl)] font-semibold leading-snug">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-[var(--text-lg)] font-semibold leading-snug">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-[var(--text-md)] font-semibold leading-snug">{children}</h3>;
    },
    h4({ children }) {
      return <h4 className="font-semibold leading-snug">{children}</h4>;
    },
    hr() {
      return <hr className="border-border" />;
    },
    input(props) {
      return (
        <input
          checked={props.checked}
          className="mr-2 align-middle accent-[var(--color-accent)]"
          readOnly
          type="checkbox"
        />
      );
    },
    li({ children }) {
      return <li className="pl-1">{children}</li>;
    },
    ol({ children }) {
      return <ol className="list-decimal space-y-1 pl-5">{children}</ol>;
    },
    p({ children }) {
      return <p>{children}</p>;
    },
    pre({ children }) {
      return (
        <pre className="overflow-auto rounded-hcbMd border border-border bg-bg-tertiary p-3 text-[var(--text-sm)]">
          {children}
        </pre>
      );
    },
    table({ children }) {
      return (
        <div className="overflow-auto rounded-hcbMd border border-border">
          <table className="min-w-full border-collapse text-left text-[var(--text-sm)]">{children}</table>
        </div>
      );
    },
    td({ children }) {
      return <td className="border-t border-border px-2 py-1 align-top">{children}</td>;
    },
    th({ children }) {
      return <th className="border-b border-border bg-bg-tertiary px-2 py-1 font-semibold">{children}</th>;
    },
    ul({ children }) {
      return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
    }
  };

  if (body.trim().length === 0) {
    return <EmptyState description={emptyDescription} title={emptyTitle} />;
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cx(
        "grid content-start gap-2 text-[var(--text-base)] leading-relaxed text-text-secondary",
        variant === "card" && "min-h-[260px] rounded-hcbMd border border-border bg-surface-0 px-3 py-2",
        className
      )}
      role="region"
    >
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
