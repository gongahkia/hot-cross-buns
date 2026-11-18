import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import mermaidUrl from 'mermaid/dist/mermaid.min.js?url';

const Diagram = styled.div`min-width:0;margin:8px 0;iframe{display:block;width:100%;border:0;}summary{min-height:36px;color:var(--muted);font-size:12px;cursor:pointer;}@media(pointer:coarse){summary{min-height:44px;}}`;
const supportedDiagram = (source: string) => source.length <= 6000 && source.split(/[\n\r;]/).length <= 120 && !/%%\s*\{|^---/m.test(source);
// this script is static; untrusted diagram text arrives only through postMessage.
const bootstrap = String.raw`
addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'render-diagram') return;
  const { source, token, dark } = event.data;
  try {
    if (typeof source !== 'string' || source.length > 6000 || source.split(/[\n\r;]/).length > 120 || /%%\s*\{|^---/m.test(source)) throw Error('Unsupported diagram configuration');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 6000, maxEdges: 100, theme: dark ? 'dark' : 'neutral', flowchart: { htmlLabels: false }, secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'secure'] });
    const result = await mermaid.render('hcb-diagram', source);
    document.getElementById('diagram').innerHTML = result.svg;
    parent.postMessage({ type: 'diagram-result', token, height: document.body.scrollHeight }, '*');
  } catch {
    parent.postMessage({ type: 'diagram-result', token, error: 'This diagram could not be rendered. Its source is available.' }, '*');
  }
});
parent.postMessage({ type: 'diagram-ready' }, '*');
`;
const frameDocument = (asset: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${location.origin}; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>body{margin:0;font:14px system-ui;overflow:auto}svg{display:block;max-width:100%;height:auto}</style></head><body><div id="diagram"></div><script src="${asset.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></script><script>${bootstrap}</script></body></html>`;

export function MarkdownDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLIFrameElement>(null), host = useRef<HTMLDivElement>(null), token = useMemo(() => crypto.randomUUID(), [source]);
  const [visible, setVisible] = useState(false), [state, setState] = useState<{ token: string; height?: number; error?: string }>({ token });
  const supported = supportedDiagram(source);
  const doc = useMemo(() => frameDocument(new URL(mermaidUrl, location.href).href), []);
  useEffect(() => {
    if (!host.current || !supported) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [supported]);
  useEffect(() => {
    if (!visible || !supported) return;
    let timer = setTimeout(() => setState({ token, error: 'The diagram could not load. Its source is available.' }), 15_000);
    const receive = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (event.data?.type === 'diagram-ready') {
        clearTimeout(timer); timer = setTimeout(() => setState({ token, error: 'The diagram exceeded its time budget. Its source is available.' }), 3000);
        ref.current?.contentWindow?.postMessage({ type: 'render-diagram', source, token, dark: document.documentElement.dataset.theme === 'night' }, '*');
      } else if (event.data?.type === 'diagram-result' && event.data.token === token) {
        clearTimeout(timer);
        setState(event.data.error ? { token, error: String(event.data.error) } : { token, height: Math.min(600, Math.max(80, Number(event.data.height) || 80)) });
      }
    };
    window.addEventListener('message', receive); return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [visible, supported, source, token]);
  const current = state.token === token ? state : { token };
  return <Diagram ref={host}>{visible && supported && !current.error && <iframe key={token} ref={ref} title="Mermaid diagram" sandbox="allow-scripts" srcDoc={doc} style={{ height: current.height ?? 80 }} aria-busy={!current.height}/>}<details open={!supported || !!current.error || !current.height}><summary>{!supported ? 'Diagram source (rendering limit)' : current.error ? 'Diagram source (preview unavailable)' : 'Diagram source'}</summary><pre><code>{source}</code></pre>{current.error && <p role="status">{current.error}</p>}</details></Diagram>;
}
