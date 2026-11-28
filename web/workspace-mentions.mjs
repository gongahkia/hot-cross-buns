import { opendir, lstat } from 'node:fs/promises';
import { join, basename, dirname, extname, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadExtensions } from '../app-host/src/uploads.mjs';
import { attachmentLimit } from '../app-host/src/attachment-limits.mjs';
import { readBoundedFile } from '../app-host/src/files.mjs';

const excluded = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', 'runtime', 'coverage', '__pycache__']);
export function workspaceMentions(host) {
  let cached, tokens = new Map();
  const owner = async context => {
    host.mutable();
    if (context !== host.context || host.sessions.switching || !host.backend.state?.source) throw new Error('Return to the selected workspace before referencing a file.');
    const backend=host.backend;
    const result=backend.workspace?await backend.workspace({request_id:randomUUID(),operation:'status',path:''}):null;
    if(result?.error)throw new Error(result.error);
    if(host.backend!==backend||host.context!==context)throw new Error('The conversation changed. Search again.');
    return {backend,source:result?.navigation?.working || result?.navigation?.root || backend.state.source,navigation:result?.navigation};
  };
  async function check(context, captured) { const current = await owner(context); if (current.backend !== captured.backend || current.source !== captured.source) throw new Error('The workspace changed. Search for the file again.'); }
  async function search(context, query) {
    if (typeof query !== 'string' || query.length > 256 || /[\x00-\x1f]/.test(query)) throw new Error('Shorten the file search.');
    const captured = await owner(context);
    if (!cached || cached.source !== captured.source || Date.now() - cached.at > 30000 || cached.working!==captured.navigation?.working) {
      const paths = [], queue = [''], visited=new Set(); let entries = 0, truncated = false;
      while (queue.length && !truncated) {
        const directory = queue.shift();if(visited.has(directory))continue;visited.add(directory);
        // Never follow directory links while enumerating names.
        try {if ((await lstat(join(captured.source,directory))).isSymbolicLink())continue;}catch {continue;}
        let handle; try { handle = await opendir(join(captured.source, directory)); } catch { continue; }
        for await (const entry of handle) {
          if (++entries > 12000) { truncated = true; break; }
          if (entry.name.startsWith('.') || /[\x00-\x1f\\]/.test(entry.name)) continue;
          const path = directory ? directory + '/' + entry.name : entry.name;
          if (path.length > 1024) continue;
          if (entry.isDirectory() && !excluded.has(entry.name) && path.split('/').length < 16) queue.push(path);
          else if (entry.isFile() && uploadExtensions.includes(extname(entry.name).slice(1).toLowerCase())) paths.push(path);
        }
      }
      await check(context, captured); cached = { source: captured.source,working:captured.navigation?.working, at: Date.now(), paths, truncated };
    }
    const needle = query.toLowerCase().replace(/^\.\//, '');
    const recent=new Map((captured.navigation?.recent_files || []).map((item,i)=>[relative(captured.source,item.path),i]));
    const matches = [...new Set(cached.paths)].filter(path => path.toLowerCase().includes(needle)).sort((a,b) => {
      const rank = p => basename(p).toLowerCase().startsWith(needle) ? 0 : 1;
      return (recent.get(a)??100)-(recent.get(b)??100) || rank(a)-rank(b) || a.split('/').length-b.split('/').length || a.localeCompare(b);
    });
    for (const [id, item] of tokens) if (item.expires < Date.now()) tokens.delete(id);
    const files = matches.slice(0, 30).map(path => {
      const id = randomUUID(); tokens.set(id, { ...captured, context, path, expires: Date.now()+300000 });
      return { id, path, name: basename(path), directory: dirname(path)==='.'?'':dirname(path), extension: extname(path).slice(1) };
    });
    while (tokens.size > 512) tokens.delete(tokens.keys().next().value);
    return { files, root:captured.source,working:captured.navigation?.working,truncated: cached.truncated || matches.length > 30 };
  }
  async function read(context, id) {
    const captured = await owner(context), item = tokens.get(id);
    if (!item || item.expires < Date.now() || item.context !== context || item.backend !== captured.backend || item.source !== captured.source) throw new Error('This file selection expired. Search for it again.');
    const bytes = await readBoundedFile(item.source, item.path, attachmentLimit(item.path));
    await check(context, captured);
    return { name: basename(item.path), bytes, path: item.path };
  }
  async function remember(context,path){const captured=await owner(context);if(captured.backend.workspace)await captured.backend.workspace({request_id:randomUUID(),operation:'recent-file',path:join(captured.source,path)});}
  return { search, read,remember };
}
