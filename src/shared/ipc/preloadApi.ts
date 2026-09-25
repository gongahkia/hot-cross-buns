import type { HcbResult } from "./result";

/** Privileged API exposed by preload. Each namespace is explicitly populated by
 * the bridge; the index signature keeps restored optional feature namespaces
 * forward-compatible while all values still cross validated IPC handlers. */
export interface HcbApi {
  [namespace: string]: any;
  bootstrap: { get(request: unknown): Promise<HcbResult<any>> };
  tasks: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  calendar: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  notes: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  tags: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  settings: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  search: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  google: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  diagnostics: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
  native: Record<string, any>;
  sync: Record<string, any>;
  undo: Record<string, (...args: any[]) => Promise<HcbResult<any>>>;
}

