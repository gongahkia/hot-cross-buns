import { createHash } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import { readBoundedFile } from '../app-host/src/files.mjs';
import { inspectContent } from '../app-host/src/file-content.mjs';
import { attachmentPreview } from './attachment-preview.mjs';

export async function localFilePreview(host, { context, name, run }) {
  if (host.context !== context || typeof name !== 'string' || name.length > 512 || !/^[\w-][\w.-]*(?:\/[\w.-]+)*\.[a-z0-9]+$/i.test(name) || name.split('/').some(part => part.startsWith('.'))) throw new Error('Choose a local file in the current conversation.');
  host.mutable();
  const current = host.backend;
  const owners = [...host.sessions.workers].filter(owner => !owner.closed && (owner === current || host.sessions.canOpen(owner.state?.conversation_id)));
  const candidates = [];
  for (const owner of run ? owners : []) {
    const bundles = [...(owner.state.messages || []).map(message => message.bundle), owner.state.work_details?.latest_bundle].filter(Boolean);
    for (const bundle of bundles) {
      if (run && bundle.RunID !== run) continue;
      for (const file of bundle.Artifacts || []) if (file.Valid && (file.Path === name || basename(file.Path).toLowerCase() === name.toLowerCase())) {
        if (!candidates.some(item => item.bundle.Path === bundle.Path && item.file.Path === file.Path)) candidates.push({ bundle, file });
      }
    }
  }
  // A main-chat task can be retired from the live session cache. Follow only
  // task identities already linked by this conversation's native owner.
  const ids = [...new Set((current.state.dialogue || []).map(turn => turn.task_chat).filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(id)))].slice(-16);
  if (run && host.backendStateRoot) for (const id of ids) {
    try {
      const directory = join(host.backendStateRoot, 'hot-cross-buns', 'conversations', id);
      const metadata = JSON.parse(await readBoundedFile(directory, 'conversation.json', 128 * 1024));
      if (metadata.id !== id || !/^[a-zA-Z0-9_-]{1,96}$/.test(metadata.head_revision_id || '')) continue;
      const revision = JSON.parse(await readBoundedFile(directory, 'revisions/' + metadata.head_revision_id + '.json', 8 * 1024 * 1024));
      if (revision.conversation_id !== id || revision.id !== metadata.head_revision_id || typeof revision.bundle_path !== 'string') continue;
      const root = join(host.backendStateRoot, 'hot-cross-buns', 'workspaces');
      const path = relative(root, revision.bundle_path);
      const manifest = JSON.parse(await readBoundedFile(root, join(path, 'manifest.json'), 2 * 1024 * 1024));
      if (manifest.run_id !== revision.id || run && manifest.run_id !== run) continue;
      for (const file of manifest.artifacts || []) if (typeof file.path === 'string' && (file.path === name || basename(file.path).toLowerCase() === name.toLowerCase())) {
        if (!candidates.some(item => item.bundle.Path === revision.bundle_path && item.file.Path === file.path)) candidates.push({bundle:{Path:revision.bundle_path},file:{Path:file.path,SHA256:file.sha256}});
      }
    } catch { /* an unavailable retired task grants no fallback file access */ }
  }
  if (candidates.length > 1) throw new Error('Several retained files have this name. Open its task and choose the exact file.');
  let bytes, note;
  if (candidates.length) {
    const { bundle, file } = candidates[0];
    bytes = await readBoundedFile(join(bundle.Path, 'output'), file.Path, 512 * 1024);
    if (createHash('sha256').update(bytes).digest('hex') !== file.SHA256) throw new Error('The retained file changed. Reopen its original task.');
    note = 'Retained task output';
  } else {
    if (!current.state?.source) throw new Error('No workspace is selected for this chat.');
    try { bytes = await readBoundedFile(current.state.source, name.replace(/^source\//, ''), 512 * 1024); }
    catch (error) { if (run && error.code === 'ENOENT') throw new Error('This file was not retained for the selected answer or found in the current workspace.'); throw error; }
    note = 'Current workspace file';
  }
  if (host.backend !== current || host.context !== context || current.closed || host.sessions.switching) throw new Error('The conversation changed. Hover the file again.');
  return { name, ...attachmentPreview(inspectContent(name, bytes)), note };
}
