import { marked, DOMPurify, highlight } from "/vendor/render-deps.mjs";
import { icon } from './icons.mjs';
import { localAppURL } from './local-url.mjs';

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

let mermaid;
let diagramId = 0;
function diagramRenderer() {
  mermaid ??= import("/vendor/mermaid-entry.mjs").then(({ default: renderer }) => {
    renderer.initialize({
      startOnLoad: false, securityLevel: "strict", theme: "neutral",
      fontFamily: "system-ui, sans-serif", suppressErrorRendering: true,
      flowchart: { htmlLabels: false },
    });
    return renderer;
  }).catch(error => { mermaid = undefined; throw error; });
  return mermaid;
}

function previewFrame(source, language) {
  const frame = element("iframe");
  frame.className = language + "-preview";
  frame.title = language === "svg" ? "SVG preview" : "HTML preview";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.referrerPolicy = "no-referrer";
  frame.addEventListener("load", () => frame.contentWindow.postMessage({ type: "render-artifact", source }, "*"), { once: true });
  frame.src = "/artifact";
  return frame;
}
window.addEventListener("message", event => {
  if (event.data?.type !== "artifact-size" || !Number.isFinite(event.data.height)) return;
  for (const frame of document.querySelectorAll(".artifact iframe")) {
    if (event.source === frame.contentWindow) frame.style.height = Math.min(1600, Math.max(80, event.data.height)) + "px";
  }
});

export function codeBlock(source, language = "") {
  const wrapper = element("div", undefined, "code-block");
  const bar = element("div", undefined, "code-toolbar");
  const copy = element("button", undefined, "quiet copy-code icon-button");
  const copiedStatus = element('span', 'Copy', 'sr-only');
  function copyState(name, text) { copiedStatus.textContent = text; copy.replaceChildren(icon(name), copiedStatus); copy.title = text; }
  copyState('copy', 'Copy');
  copy.type = "button";
  copy.setAttribute("aria-label", "Copy " + (language || "code"));
  copy.setAttribute("aria-live", "polite");
  copy.addEventListener("click", async () => {
    copyState('loader-circle', 'Copying…');
    let timer;
    try {
      await Promise.race([
        navigator.clipboard.writeText(source),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Clipboard unavailable")), 1200); }),
      ]);
      copyState('check', 'Copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* selection remains available for manual copying */ }
      copyState(copied ? 'check' : 'copy', copied ? 'Copied' : 'Selected · press ⌘C / Ctrl+C');
      copiedStatus.classList.toggle('sr-only', copied);
    } finally { clearTimeout(timer); }
    setTimeout(() => { copiedStatus.classList.add('sr-only'); copyState('copy', 'Copy'); }, 2500);
  });
  bar.append(element("span", language === "incomplete" ? "" : language), copy);
  const pre = element("pre"), code = element("code", source);
  const grammar = language === "svg" || language === "html" ? "xml" : language;
  if (highlight.getLanguage(grammar) && source.length <= 100000) {
    code.replaceChildren(DOMPurify.sanitize(highlight.highlight(source, { language: grammar, ignoreIllegals: true }).value, { RETURN_DOM_FRAGMENT: true }));
  }
  pre.append(code);
  wrapper.append(bar, pre);
  return wrapper;
}

const tableWidths = new Map();
export function resizableTable(table) {
  const wrapper = element("div", undefined, "table-wrap");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("aria-label", "Table with resizable columns");
  const headers = [...table.querySelectorAll("thead th")];
  const cols = element("colgroup");
  const key = table.outerHTML;
  const widths = tableWidths.get(key)?.slice() || headers.map(() => 180);
  cols.append(...headers.map(() => element("col")));
  table.prepend(cols);
  function resize(index, width) {
    widths[index] = Math.max(80, Math.min(1200, width));
    [...cols.children].forEach((col, i) => { col.style.width = widths[i] + "px"; });
    table.style.width = widths.reduce((sum, value) => sum + value, 0) + "px";
    tableWidths.set(key, widths.slice());
    if (tableWidths.size > 64) tableWidths.delete(tableWidths.keys().next().value);
    headers[index].querySelector(".column-resize").setAttribute("aria-valuenow", String(Math.round(widths[index])));
  }
  headers.forEach((header, index) => {
    const handle = element("span", undefined, "column-resize");
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize " + header.textContent + " column");
    handle.setAttribute("aria-valuemin", "80");
    handle.setAttribute("aria-valuemax", "1200");
    handle.setAttribute("aria-valuenow", String(Math.round(widths[index])));
    let startX, startWidth;
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      headers.forEach((cell, i) => { widths[i] = cell.getBoundingClientRect().width || widths[i]; });
      startX = event.clientX; startWidth = widths[index];
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (handle.hasPointerCapture(event.pointerId)) resize(index, startWidth + event.clientX - startX);
    });
    handle.addEventListener("pointerup", event => {
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    });
    handle.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      headers.forEach((cell, i) => { widths[i] = cell.getBoundingClientRect().width || widths[i]; });
      resize(index, widths[index] + (event.key === "ArrowRight" ? 20 : -20));
    });
    header.append(handle);
  });
  if (tableWidths.has(key)) {
    [...cols.children].forEach((col, i) => { col.style.width = widths[i] + "px"; });
    table.style.width = widths.reduce((sum, value) => sum + value, 0) + "px";
  }
  table.replaceWith(wrapper);
  wrapper.append(table);
  return wrapper;
}

let mathRenderer;
function typesetMath(node) {
  mathRenderer ??= import("/vendor/math-entry.mjs").catch(error => { mathRenderer = undefined; throw error; });
  void mathRenderer.then(({ mathToSVG }) => {
    const source = decodeURIComponent(node.dataset.tex);
    const svg = mathToSVG(source, node.dataset.display === "true");
    node.replaceChildren(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true }, RETURN_DOM_FRAGMENT: true }));
    node.setAttribute("aria-label", source);
    node.removeAttribute("data-tex");
  }).catch(() => { node.title = "Math could not be rendered. The TeX source is shown."; });
}

function richBlock(code, language) {
  const source = code.textContent;
  if(language==='canvas') {
    try {
      const doc=JSON.parse(source);
      if(typeof doc.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(doc.id)||typeof doc.title!=='string'||doc.title.length>160||!['markdown','html','svg','mermaid','text','js','ts','css','python','go'].includes(doc.language)||typeof doc.content!=='string'||doc.content.length>131072)throw new Error();
      const card=element('button',undefined,'canvas-card quiet');card.type='button';card.append(icon('file-text'),element('span',doc.title),element('small','Open in Canvas'));
      card.addEventListener('click',()=>document.dispatchEvent(new window.CustomEvent('open-canvas',{detail:doc})));return card;
    }catch{return codeBlock(source,'canvas')}
  }
  const block = element("figure", undefined, "artifact");
  const output = element("div", undefined, "artifact-output");
  const sourceDetails = element("details", undefined, "artifact-source");
  const sourceSummary = element('summary', 'Source · ' + language), chevron = icon('chevron-right');
  chevron.classList.add('disclosure-icon'); sourceSummary.prepend(chevron);
  sourceDetails.append(sourceSummary, codeBlock(source, language));
  block.append(output, sourceDetails);
  if (language === "mermaid") {
    output.textContent = "Rendering diagram…";
    void diagramRenderer().then(renderer => renderer.render("diagram-" + ++diagramId, source)).then(({ svg }) => {
      output.replaceChildren(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM_FRAGMENT: true }));
      output.setAttribute("aria-label", "Mermaid diagram");
    }).catch(() => {
      output.textContent = "This diagram could not be rendered. Check the source below.";
      sourceDetails.open = true;
    });
  } else output.append(previewFrame(source, language));
  return block;
}

const escapeHTML = text => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const mathToken = (raw, text, display) => ({ type: display ? "blockMath" : "inlineMath", raw, text, display });
const mathHTML = token => `<span class="math-expression${token.display ? " display-math" : ""}" data-tex="${encodeURIComponent(token.text)}" data-display="${token.display}">${escapeHTML(token.text)}</span>`;
marked.use({ extensions: [
  { name: "blockMath", level: "block", start: source => source.search(/\$\$|\\\[/),
    tokenizer(source) {
      const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)/.exec(source);
      if (match) return mathToken(match[0], (match[1] || match[2]).trim(), true);
    }, renderer: mathHTML },
  { name: "inlineMath", level: "inline", start: source => source.search(/\$[^\s$]|\\\(/),
    tokenizer(source) {
      const match = /^(?:\$(?!\s)([^$\n]*?\S)\$(?!\d)|\\\(([\s\S]+?)\\\))/.exec(source);
      if (match) return mathToken(match[0], match[1] || match[2], false);
    }, renderer: mathHTML },
] });

// Raw HTML is shown as text. Explicit fenced artifacts render inside an opaque frame.
const renderer = new marked.Renderer();
renderer.html = ({ text }) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

renderer.code = function(token) {
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(token.raw)?.[1];
  const closing = /\n[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(token.raw.trimEnd())?.[1];
  const complete = opening && closing && opening[0] === closing[0] && closing.length >= opening.length;
  return marked.Renderer.prototype.code.call(this, {
    ...token, lang: complete ? token.lang : "incomplete",
  });
};

export function prose(text, { previews = true } = {}) {
  const result = DOMPurify.sanitize(marked.parse(String(text ?? ""), { renderer, breaks: true }), {
    USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["style", "input", "form", "button", "iframe"],
  });
  for (const link of result.querySelectorAll("a")) {
    try {
      const url = new URL(link.getAttribute("href"), location.href);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (localAppURL(url.href)) {
        link.addEventListener('click', event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); document.dispatchEvent(new window.CustomEvent('open-local-app', {detail:{url:url.href,trigger:link}}));
        });
        link.title = 'Open local app beside this chat';
      }
      const extension = url.pathname.match(/\.(gif|png|jpe?g|webp|mp4|webm|ogv|mov|m4v)$/i)?.[1]?.toLowerCase();
      const youtube = ['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname) ? url.searchParams.get('v') : url.hostname === 'youtu.be' ? url.pathname.slice(1) : null;
      const vimeo = ['vimeo.com','www.vimeo.com'].includes(url.hostname) ? url.pathname.slice(1) : null;
      const embed = youtube && /^[\w-]{11}$/.test(youtube) ? 'https://www.youtube-nocookie.com/embed/'+youtube : vimeo && /^\d+$/.test(vimeo) ? 'https://player.vimeo.com/video/'+vimeo : null;
      if (previews && (extension || embed) && !link.querySelector('img')) {
        const wrap = element('span', undefined, 'inline-media');
        if (embed) {
          const play = element('button','Load video','quiet'); play.type='button';
          play.addEventListener('click',()=>{ const frame=element('iframe');frame.title=link.textContent || 'Video';frame.src=embed;frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');frame.setAttribute('allow','fullscreen; picture-in-picture');frame.allowFullscreen=true;play.replaceWith(frame); });
          wrap.append(play);
        } else if (['mp4','webm','ogv','mov','m4v'].includes(extension)) {
          const video=element('video');video.controls=true;video.preload='none';video.playsInline=true;video.src=url.href;video.setAttribute('aria-label',link.textContent || 'Video');wrap.append(video);
        } else {
          const image=element('img');image.src=url.href;image.alt=link.textContent || 'Image';wrap.append(image);
        }
        link.replaceWith(wrap);wrap.append(link);
      }
    } catch { link.removeAttribute("href"); }
  }
  for (const code of result.querySelectorAll('code')) if (!code.closest('pre, a') && localAppURL(code.textContent.trim())) {
    const link = element('a', code.textContent); link.href = localAppURL(code.textContent.trim()); link.title = 'Open local app beside this chat';
    link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { link.target = '_blank'; link.rel = 'noopener noreferrer'; return; } event.preventDefault(); document.dispatchEvent(new window.CustomEvent('open-local-app', {detail:{url:link.href,trigger:link}})); });
    code.replaceChildren(link);
  }
  for (const image of result.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    if (!/^(https?:\/\/|\/(?!\/)|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(src)) {
      image.replaceWith(element("span", image.alt || "Image unavailable", "hint"));
      continue;
    }
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.replaceWith(element("span", image.alt + " · Image unavailable", "hint")), { once: true });
  }
  for (const code of result.querySelectorAll("pre > code")) {
    const language = code.className.match(/^language-([\w+-]+)$/)?.[1] || "";
    const rich = previews && ["html", "svg", "mermaid", "canvas"].includes(language);
    code.parentElement.replaceWith(rich ? richBlock(code, language) : codeBlock(code.textContent, language));
  }
  for (const table of result.querySelectorAll("table")) resizableTable(table);
  for (const math of result.querySelectorAll(".math-expression[data-tex]")) typesetMath(math);
  return result;
}

export function responseCopy(read) {
  const tools = element('div', undefined, 'response-tools');
  const copy = element('button', undefined, 'quiet icon-button'); copy.type = 'button'; copy.title = 'Copy response'; copy.setAttribute('aria-label', 'Copy response'); copy.append(icon('copy'));
  const status = element('span', '', 'sr-only'); status.setAttribute('role', 'status');
  tools.append(copy, status);
  copy.addEventListener('click', async () => {
    const text = read(); copy.disabled = true;
    try { await navigator.clipboard.writeText(text); copy.replaceChildren(icon('check')); copy.title = 'Copied'; status.textContent = 'Response copied'; tools.querySelector('textarea')?.remove(); }
    catch {
      let fallback = tools.querySelector('textarea');
      if (!fallback) { fallback = element('textarea'); fallback.readOnly = true; fallback.setAttribute('aria-label', 'Response source to copy'); tools.append(fallback); }
      fallback.value = text; fallback.focus(); fallback.select(); status.textContent = 'Press Cmd+C or Ctrl+C to copy the selected source.';
    } finally { copy.disabled = false; }
    setTimeout(() => { copy.replaceChildren(icon('copy')); copy.title = 'Copy response'; }, 2000);
  });
  return tools;
}

export function turn(text, user, name, options) {
  const article = element("article", undefined, user ? "turn user" : "turn");
  article.setAttribute("aria-label", name);
  if (text) {
    if (user) article.append(element("p", text));
    else { const content=element("div",undefined,"response-content");content.append(prose(text,options));article.append(content); }
  }
  if (text && !user) article.append(responseCopy(() => text));
  return article;
}
