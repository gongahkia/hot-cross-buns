import { RICH_MARKDOWN_LIMITS, type RichMarkdownResult, type RichMarkdownWork } from './richMarkdownWork.ts';

type Port = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
type Pending = { kind: RichMarkdownWork['kind']; resolve: (value: RichMarkdownResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** rich processing has its own worker so it cannot hold up journal validation. */
export class RichMarkdown {
  private port?: Port;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private inflight = new Map<string, Promise<RichMarkdownResult>>();
  private cache = new Map<string, { value: RichMarkdownResult; weight: number }>();
  private weight = 0;
  private create: () => Port;
  private timeout: number;
  constructor(create: () => Port, timeout = RICH_MARKDOWN_LIMITS.timeout) { this.create = create; this.timeout = timeout; }
  render(work: RichMarkdownWork): Promise<RichMarkdownResult> {
    if (work.source.length > (work.kind === 'math' ? RICH_MARKDOWN_LIMITS.math : RICH_MARKDOWN_LIMITS.code)) return Promise.reject(new Error('This block exceeds its rendering limit; source remains available.'));
    const key = JSON.stringify(work), cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return Promise.resolve(cached.value); }
    const shared = this.inflight.get(key);
    if (shared) return shared;
    if (this.pending.size >= RICH_MARKDOWN_LIMITS.outstanding) return Promise.reject(new Error('Rendering is busy; source remains available.'));
    try {
      if (!this.port) {
        this.port = this.create();
        this.port.onmessage = event => {
          const data = event.data, pending = this.pending.get(data?.id);
          if (!pending) return;
          this.pending.delete(data.id); clearTimeout(pending.timer);
          if (data.error) pending.reject(new Error(data.error)); else if (data.result?.kind === pending.kind) pending.resolve(data.result); else pending.reject(new Error('Unreadable rendering result.'));
        };
        this.port.onerror = event => { event.preventDefault(); this.dispose('Rich rendering failed; source remains available.'); };
        this.port.onmessageerror = () => this.dispose('Unreadable rendering result; source remains available.');
      }
    } catch { return Promise.reject(new Error('Rich rendering is unavailable; source remains available.')); }
    const id = ++this.sequence;
    const result = new Promise<RichMarkdownResult>((resolve, reject) => {
      const timer = setTimeout(() => this.dispose('Rendering exceeded its time budget; source remains available.'), this.timeout);
      this.pending.set(id, { kind: work.kind, resolve, reject, timer });
      try { this.port!.postMessage({ ...work, id }); } catch { this.pending.delete(id); clearTimeout(timer); reject(new Error('Rendering could not start; source remains available.')); }
    }).then(value => {
      const weight = key.length + JSON.stringify(value).length;
      if (weight <= RICH_MARKDOWN_LIMITS.output) {
        this.cache.set(key, { value, weight }); this.weight += weight;
        while (this.cache.size > 32 || this.weight > 1_000_000) { const oldest = this.cache.keys().next().value!; this.weight -= this.cache.get(oldest)!.weight; this.cache.delete(oldest); }
      }
      return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, result);
    return result;
  }
  dispose(message = 'Rich rendering stopped; source remains available.'): void {
    this.port?.terminate(); this.port = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
}

let client: RichMarkdown | undefined;
export const renderRichMarkdown = (work: RichMarkdownWork) => (client ??= new RichMarkdown(() => new Worker(new URL('./richMarkdownWorker.ts', import.meta.url), { type: 'module', name: 'markdown-rendering' }))).render(work);
