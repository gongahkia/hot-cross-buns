import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { full as markdownItEmoji } from "markdown-it-emoji";
import { useMemo } from "react";

interface RichDescriptionProps {
  readonly value: string;
  readonly className?: string;
}

const markdown = new MarkdownIt({ html: true, breaks: true, linkify: true, typographer: false })
  .use(markdownItEmoji);

function withTaskListInputs(value: string): string {
  return value.replace(/^(\s*[-*+]\s+)\[([ xX])\]\s+/gm, (_match, prefix: string, state: string) => `${prefix}<input type="checkbox" disabled${state.toLocaleLowerCase() === "x" ? " checked" : ""}> `);
}

function isHttps(value: string | null): boolean {
  if (!value) return false;
  try {
    return new URL(value, window.location.origin).protocol === "https:";
  } catch {
    return false;
  }
}

/** Renders Markdown, legacy HTML, or a mixture of both after strict client-side sanitization. */
export function RichDescription({ value, className }: RichDescriptionProps): React.JSX.Element {
  const html = useMemo(() => {
    const rendered = markdown.render(withTaskListInputs(value.trim()));
    return DOMPurify.sanitize(rendered, {
      ALLOWED_TAGS: ["a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "input", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
      ALLOWED_ATTR: ["align", "alt", "checked", "class", "disabled", "height", "href", "src", "title", "type", "width"],
      ALLOW_DATA_ATTR: false
    });
  }, [value]);

  const safeHtml = useMemo(() => {
    if (typeof DOMParser === "undefined") return html;
    const document = new DOMParser().parseFromString(html, "text/html");
    document.querySelectorAll<HTMLAnchorElement>("a").forEach((anchor) => {
      if (!isHttps(anchor.getAttribute("href"))) anchor.removeAttribute("href");
      else {
        anchor.href = new URL(anchor.getAttribute("href")!, window.location.origin).href;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
      }
    });
    document.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      if (!isHttps(image.getAttribute("src"))) image.remove();
    });
    return document.body.innerHTML;
  }, [html]);

  return <div className={className ? `rich-description ${className}` : "rich-description"} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
