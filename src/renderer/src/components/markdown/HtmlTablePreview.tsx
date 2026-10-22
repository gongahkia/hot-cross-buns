import { createElement, type ReactNode } from "react";
import { safeHref, safeImageSrc } from "./mixedMarkup";

const tags = new Set(["table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "p", "div", "span", "br", "strong", "b", "em", "i", "s", "del", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "img", "label", "input"]);
const discard = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template"]);

/** Render an allowlisted tree; never mount provider HTML or its attributes. */
export function HtmlTablePreview({ html, reference }: { html: string; reference: (raw: string) => ReactNode }): JSX.Element {
  function render(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (discard.has(tag)) return null;
    const children = Array.from(element.childNodes).map(render);
    if (!tags.has(tag)) return children;
    if (tag === "span" && element.hasAttribute("data-planner-reference")) return <span key={key}>{reference(element.getAttribute("data-planner-reference")!)}</span>;
    const props: Record<string, unknown> = { key };
    if (tag === "table") props.className = "min-w-full border-collapse text-left text-[var(--text-sm)]";
    if (tag === "th" || tag === "td") {
      for (const [attr, prop] of [["colspan", "colSpan"], ["rowspan", "rowSpan"]]) {
        const span = Number(element.getAttribute(attr));
        if (Number.isInteger(span) && span > 0) props[prop] = Math.min(span, 1000);
      }
      props.className = "border border-border px-2 py-1 align-top";
      if (tag === "th") props.className += " bg-bg-tertiary font-semibold";
      const align = (element as HTMLElement).style.textAlign || element.getAttribute("align");
      if (align && ["left", "center", "right"].includes(align)) props.style = { textAlign: align };
    }
    if (tag === "ul" || tag === "ol") props.className = tag === "ul" ? "list-disc pl-5" : "list-decimal pl-5";
    if (tag === "ol" && /^\d+$/.test(element.getAttribute("start") ?? "")) props.start = Number(element.getAttribute("start"));
    if (tag === "pre") props.className = "overflow-auto whitespace-pre rounded-hcbMd bg-bg-tertiary p-3 font-mono";
    if (tag === "a") { props.href = safeHref(element.getAttribute("href") ?? undefined); props.target = "_blank"; props.rel = "noreferrer"; props.className = "text-accent underline"; }
    if (tag === "img") { props.src = safeImageSrc(element.getAttribute("src") ?? undefined); props.alt = element.getAttribute("alt") ?? ""; props.className = "max-w-full"; }
    if (tag === "input") { if (element.getAttribute("type") !== "checkbox") return null; props.type = "checkbox"; props.checked = element.hasAttribute("checked"); props.disabled = true; }
    return createElement(tag, props, ...(["br", "hr", "img", "input"].includes(tag) ? [] : children));
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  return <div className="overflow-auto rounded-hcbMd border border-border bg-surface-0">{Array.from(document.body.childNodes).map(render)}</div>;
}
