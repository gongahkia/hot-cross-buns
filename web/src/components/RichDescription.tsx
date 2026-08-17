import { Fragment, type ReactNode } from "react";

interface RichDescriptionProps {
  readonly value: string;
  readonly className?: string;
}

const htmlPattern = /<\/?[a-z][^>]*>/i;
const inlineToken = /(\[[^\]]+\]\((?:https?:\/\/|mailto:|tel:)[^)\s]+\)|https?:\/\/[^\s<]+|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

function safeHref(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function inlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = inlineToken.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      const href = safeHref(link?.[2] ?? null);
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer">{link?.[1]}</a> : token);
    } else if (token.startsWith("http")) {
      const href = safeHref(token);
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer">{token}</a> : token);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
    index += 1;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function htmlNodes(nodes: NodeListOf<ChildNode> | ChildNode[], keyPrefix: string): ReactNode[] {
  return Array.from(nodes).map((node, index) => htmlNode(node, `${keyPrefix}-${index}`));
}

function htmlNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return <Fragment key={key}>{inlineMarkdown(node.textContent ?? "", key)}</Fragment>;
  if (!(node instanceof HTMLElement)) return null;
  const children = htmlNodes(node.childNodes, key);
  switch (node.tagName.toLowerCase()) {
    case "a": {
      const href = safeHref(node.getAttribute("href"));
      return href ? <a key={key} href={href} target="_blank" rel="noreferrer">{children}</a> : <Fragment key={key}>{children}</Fragment>;
    }
    case "p": return <p key={key}>{children}</p>;
    case "br": return <br key={key} />;
    case "strong":
    case "b": return <strong key={key}>{children}</strong>;
    case "em":
    case "i": return <em key={key}>{children}</em>;
    case "code": return <code key={key}>{children}</code>;
    case "pre": return <pre key={key}>{children}</pre>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "ul": return <ul key={key}>{children}</ul>;
    case "ol": return <ol key={key}>{children}</ol>;
    case "li": return <li key={key}>{children}</li>;
    case "h1": return <h3 key={key}>{children}</h3>;
    case "h2": return <h4 key={key}>{children}</h4>;
    case "h3":
    case "h4":
    case "h5":
    case "h6": return <h5 key={key}>{children}</h5>;
    default: return <Fragment key={key}>{children}</Fragment>;
  }
}

function markdownNodes(value: string): ReactNode[] {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  for (let cursor = 0; cursor < lines.length;) {
    const line = lines[cursor] ?? "";
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const content: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !(lines[cursor] ?? "").startsWith("```")) content.push(lines[cursor++] ?? "");
      if (cursor < lines.length) cursor += 1;
      nodes.push(<pre key={`block-${index++}`}><code>{content.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = heading[1].length === 1 ? "h3" : heading[1].length === 2 ? "h4" : "h5";
      nodes.push(<Tag key={`block-${index++}`}>{inlineMarkdown(heading[2], `heading-${index}`)}</Tag>);
      cursor += 1;
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || ordered) {
      const items: ReactNode[] = [];
      const pattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (cursor < lines.length) {
        const matched = pattern.exec(lines[cursor] ?? "");
        if (!matched) break;
        items.push(<li key={`item-${cursor}`}>{inlineMarkdown(matched[1], `item-${cursor}`)}</li>);
        cursor += 1;
      }
      nodes.push(ordered ? <ol key={`block-${index++}`}>{items}</ol> : <ul key={`block-${index++}`}>{items}</ul>);
      continue;
    }
    if (line.startsWith("> ")) {
      const content: string[] = [];
      while (cursor < lines.length && (lines[cursor] ?? "").startsWith("> ")) {
        content.push((lines[cursor++] ?? "").slice(2));
      }
      nodes.push(<blockquote key={`block-${index++}`}>{inlineMarkdown(content.join("\n"), `quote-${index}`)}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (cursor < lines.length && (lines[cursor] ?? "").trim() && !/^(#{1,3})\s+|^[-*+]\s+|^\d+[.)]\s+|^> |^```/.test(lines[cursor] ?? "")) paragraph.push(lines[cursor++] ?? "");
    nodes.push(<p key={`block-${index++}`}>{paragraph.flatMap((part, partIndex) => partIndex === 0 ? inlineMarkdown(part, `paragraph-${index}-${partIndex}`) : [<br key={`break-${partIndex}`} />, ...inlineMarkdown(part, `paragraph-${index}-${partIndex}`)])}</p>);
  }
  return nodes;
}

/** Safely renders Google descriptions as HTML or Markdown without injecting raw markup. */
export function RichDescription({ value, className }: RichDescriptionProps): React.JSX.Element {
  const content = value.trim();
  if (!content) return <div className={className} />;
  const rendered = htmlPattern.test(content) && typeof DOMParser !== "undefined"
    ? htmlNodes(new DOMParser().parseFromString(content, "text/html").body.childNodes, "html")
    : markdownNodes(content);
  return <div className={className ? `rich-description ${className}` : "rich-description"}>{rendered}</div>;
}
