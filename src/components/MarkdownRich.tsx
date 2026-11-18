import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import type { Nodes } from 'hast';
import { renderRichMarkdown } from '../richMarkdown';
import type { RichMarkdownResult, RichMarkdownWork } from '../richMarkdownWork';

const Code = styled.pre`[class*=hljs-comment],[class*=hljs-quote]{color:var(--muted);}[class*=hljs-keyword],[class*=hljs-selector],[class*=hljs-literal]{color:var(--link);font-weight:500;}[class*=hljs-string],[class*=hljs-number],[class*=hljs-title],[class*=hljs-attr]{color:var(--ink);font-weight:500;}`;
const Formula = styled.span`display:inline-block;max-width:100%;overflow:auto;vertical-align:middle;.katex-display{margin:8px 0;} &[data-display=true]{display:block;}`;

function useRich(work: RichMarkdownWork) {
  const element = useRef<HTMLElement | null>(null), key = JSON.stringify(work);
  const [state, setState] = useState<{ key: string; result?: RichMarkdownResult; error?: string }>({ key });
  const [visible, setVisible] = useState(false);
  const ref = useCallback((node: HTMLElement | null) => { element.current = node; }, []);
  useEffect(() => {
    if (!element.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(element.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    const started = performance.now();
    const render = () => { void renderRichMarkdown(work).then(result => { if (current) setState({ key, result }); }, error => { if (!current) return; if (String(error).includes('Rendering is busy') && performance.now() - started < 3000) timer = setTimeout(render, 100); else setState({ key, error: String(error) }); }); };
    let timer = setTimeout(render, 60);
    return () => { current = false; clearTimeout(timer); };
  }, [visible, key]);
  return { ref, ...(state.key === key ? state : { key }) };
}

function highlight(node: Nodes, key: number, depth = 0): ReactNode {
  if (depth > 32) return null;
  if (node.type === 'text') return node.value;
  if (node.type === 'element' && node.tagName === 'span') return <span key={key} className={Array.isArray(node.properties.className) ? node.properties.className.filter(value => typeof value === 'string' && /^hljs-[a-z0-9_-]+$/i.test(value)).join(' ') : undefined}>{node.children.map((child, index) => highlight(child, index, depth + 1))}</span>;
  if ('children' in node) return node.children.map((child, index) => highlight(child, index, depth + 1));
  return null;
}

function HighlightedCode({ source, language }: { source: string; language: string }) {
  const state = useRich({ kind: 'highlight', source, language: language?.toLowerCase() ?? '' });
  return <Code ref={state.ref} title={state.error} data-code-language={language}><code>{state.result?.kind === 'highlight' ? highlight(state.result.tree, 0) : source}</code></Code>;
}

export function MarkdownCode({ source, language }: { source: string; language?: string }) {
  return language && language !== 'hcb' ? <HighlightedCode source={source} language={language}/> : <pre><code>{source}</code></pre>;
}

export function MarkdownMath({ source, display = false, fallback }: { source: string; display?: boolean; fallback: string }) {
  const state = useRich({ kind: 'math', source, display });
  const [css, setCss] = useState<'pending' | 'ready' | 'error'>('pending');
  useEffect(() => { if (state.result?.kind === 'math') void import('katex/dist/katex.min.css').then(() => setCss('ready'), () => setCss('error')); }, [state.result]);
  return <Formula ref={state.ref} data-display={display} title={state.error ?? (css === 'error' ? 'Math styles could not load; source remains available.' : undefined)}>{state.result?.kind === 'math' && css === 'ready' ? <span aria-label={source} dangerouslySetInnerHTML={{ __html: state.result.html }}/> : <code>{fallback}</code>}</Formula>;
}
