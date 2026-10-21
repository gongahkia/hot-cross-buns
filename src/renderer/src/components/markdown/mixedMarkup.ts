export function safeHref(href: string | undefined): string | undefined {
  const trimmed = href?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

export function safeImageSrc(src: string | undefined): string | undefined {
  const trimmed = src?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^data:image\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^https?:/i.test(trimmed) || (trimmed.startsWith("/") && !trimmed.startsWith("//"))) {
    return trimmed;
  }

  return undefined;
}

const supportedHtmlTags = /<\/?(?:a|article|aside|b|blockquote|br|code|del|div|em|figcaption|figure|h[1-6]|hr|i|img|li|main|ol|p|pre|s|section|span|strike|strong|u|ul)\b/i;

function markdownLinkLabel(value: string): string {
  return value.replace(/([\[\]])/g, "\\$1");
}

function htmlChildrenToMarkdown(element: Element): string {
  return Array.from(element.childNodes).map(htmlNodeToMarkdown).join("");
}

function htmlNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  const body = htmlChildrenToMarkdown(element);

  if (["script", "style", "iframe", "object", "embed", "form", "input", "button"].includes(tagName)) {
    return "";
  }

  if (tagName === "br") return "\n";
  if (tagName === "hr") return "\n\n---\n\n";
  if (tagName === "a") {
    const href = safeHref(element.getAttribute("href") ?? undefined);
    const label = markdownLinkLabel(body.trim());
    return href && label ? `[${label}](<${href.replace(/>/g, "%3E")}>)` : body;
  }
  if (tagName === "img") {
    const src = safeImageSrc(element.getAttribute("src") ?? undefined);
    const alt = element.getAttribute("alt")?.trim() ?? "";
    return src ? `![${markdownLinkLabel(alt)}](<${src.replace(/>/g, "%3E")}>)` : "";
  }
  if (["strong", "b"].includes(tagName)) return `**${body}**`;
  if (["em", "i"].includes(tagName)) return `*${body}*`;
  if (["del", "s", "strike"].includes(tagName)) return `~~${body}~~`;
  if (tagName === "code") return `\`${body.replace(/`/g, "\\`")}\``;
  if (tagName === "pre") return `\n\n\`\`\`\n${body.trim()}\n\`\`\`\n\n`;
  if (/^h[1-6]$/.test(tagName)) return `\n\n${"#".repeat(Number(tagName[1]))} ${body.trim()}\n\n`;
  if (tagName === "li") return `- ${body.trim()}\n`;
  if (tagName === "ul" || tagName === "ol") return `\n${body}\n`;
  if (tagName === "blockquote") return `\n\n${body.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  if (["p", "div", "section", "article", "aside", "main", "figure", "figcaption"].includes(tagName)) {
    return `\n\n${body.trim()}\n\n`;
  }

  return body;
}

/**
 * Converts the safe, presentational subset of HTML commonly returned by
 * Google Calendar into Markdown before it reaches ReactMarkdown. This lets a
 * description freely mix HTML and Markdown without rendering arbitrary HTML.
 */
export function markdownFromMixedMarkup(body: string): string {
  if (!supportedHtmlTags.test(body) || typeof DOMParser === "undefined") {
    return body;
  }

  // DOMParser must never consume example HTML inside Markdown code. Shield
  // fenced and inline code first, including an unfinished fence being typed.
  const literals: string[] = [];
  let prefix = "HCBPROTECTEDCODE";
  while (body.includes(prefix)) prefix += "X";
  const protect = (text: string) => `${prefix}${literals.push(text) - 1}END`;
  const fences = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  let source = ""; let offset = 0;
  for (let match = fences.exec(body); match; match = fences.exec(body)) {
    const closing = new RegExp(`^ {0,3}${match[1][0]}{${match[1].length},}[ \\t]*(?:\\n|$)`, "gm");
    closing.lastIndex = fences.lastIndex;
    const end = closing.exec(body);
    const limit = end ? closing.lastIndex : body.length;
    source += body.slice(offset, match.index) + protect(body.slice(match.index, limit));
    offset = limit; fences.lastIndex = limit;
  }
  source += body.slice(offset);
  source = source.replace(/(`+)([\s\S]*?)\1(?!`)/g, (match) => protect(match));
  const document = new DOMParser().parseFromString(source, "text/html");
  const converted = Array.from(document.body.childNodes)
    .map(htmlNodeToMarkdown)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return converted.replace(new RegExp(`${prefix}(\\d+)END`, "g"), (_match, index) => literals[Number(index)]);
}

export function hasRenderableMixedMarkup(body: string | null | undefined): boolean {
  return Boolean(body && markdownFromMixedMarkup(body).trim());
}

/** Google Calendar descriptions often arrive as simple presentational HTML. */
export function markdownForEditing(body: string): string {
  if (!/^\s*<(?:p|div|h[1-6]|ul|ol|blockquote|pre|b|strong|em|a)\b/i.test(body)) return body;
  const document = new DOMParser().parseFromString(body, "text/html");
  const supported = new Set(["a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "span", "strong", "ul"]);
  if (Array.from(document.body.querySelectorAll("*")).some((element) => !supported.has(element.tagName.toLowerCase()) ||
    Array.from(element.attributes).some((attribute) => !["href", "src", "alt", "title"].includes(attribute.name)))) return body;
  return markdownFromMixedMarkup(body);
}

