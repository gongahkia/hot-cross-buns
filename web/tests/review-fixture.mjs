import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWeb } from '../server.mjs';

export async function reviewFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hcb-review-')), workspace = join(root, 'workspace'), binary = join(root, 'runtime');
  await mkdir(workspace);
  await writeFile(binary, '#!/usr/bin/env node\n' + await readFile(new URL('./review-runtime.cjs', import.meta.url), 'utf8'), { mode: 0o700 });
  let app;
  try { app = await startWeb({ binary, workspace, userData: join(root, 'app'), env: { ...process.env, HOT_CROSS_BUNS_STATE_DIR: join(root, 'state'), HOT_CROSS_BUNS_CONFIG_DIR: join(root, 'config') } }, 0); }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  return { url: app.url, async close() { try { await app.close(); } finally { await rm(root, { recursive: true, force: true }); } } };
}
