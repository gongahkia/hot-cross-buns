import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// temporary upstream fix: https://github.com/micromark/micromark/pull/249
// preserve the untouched event prefix instead of copying it for every container.
const root = new URL('../node_modules/micromark-util-edit-map/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.version !== '1.0.0') throw new Error('Review the Markdown parser prefix patch against the new upstream version.');
const files = [
  ['index.js', '0a29b60e6299a7b17e57e3c185014ad9bfe5a0ad6fd1365ce14605d6d299cbf0', '    vecs.push(events.slice());\n    events.length = 0;\n'],
  ['dev/index.js', '98048a86eeaf5d5b9c85715c124bd5865685a964cabe2a77e5039bf11d987017', '    vecs.push(events.slice())\n    events.length = 0\n\n'],
];
for (const [file, digest, fragment] of files) {
  const url = new URL(file, root), source = await readFile(url, 'utf8');
  const original = source.includes(fragment) ? source : source.replace('    let slice = vecs.pop()', fragment + '    let slice = vecs.pop()');
  if (createHash('sha256').update(original).digest('hex') !== digest) throw new Error(`Unexpected ${file} bytes; review the Markdown parser patch before continuing.`);
  if (source.includes(fragment)) {
    if (process.argv.includes('--check')) throw new Error('Run npm ci to install the required Markdown parser prefix patch.');
    await writeFile(url, source.replace(fragment, ''));
  }
}
