import assert from 'node:assert/strict';
import test from 'node:test';

const fresh = name => import(`../src/scratchpadWindow.ts?case=${name}`);
function popup(href = 'about:blank') {
  const result = { closed: false, focused: 0, navigations: [], focus() { this.focused++; }, location: {
    href, origin: href === 'about:blank' ? 'null' : new URL(href).origin,
    replace(value) { result.navigations.push(value); this.href = value; this.origin = new URL(value).origin; },
  } };
  return result;
}
function browser(opened, mobile = false) {
  const calls = [];
  return { calls, matchMedia: () => ({ matches: mobile }), location: { origin: 'https://journal.example', pathname: '/app/' }, open: (...args) => { calls.push(args); return opened; } };
}
async function using(value, work) {
  const previous = globalThis.window;
  globalThis.window = value;
  try { await work(); } finally { globalThis.window = previous; }
}

test('quick capture opens once and focuses the same window without replacing its draft', async () => {
  const opened = popup(), parent = browser(opened), { openScratchpadWindow } = await fresh('reuse');
  await using(parent, async () => {
    assert.equal(openScratchpadWindow(), true);
    assert.equal(openScratchpadWindow(), true);
    assert.equal(parent.calls.length, 1);
    assert.deepEqual(parent.calls[0], ['', 'hot-cross-buns-scratchpad', 'popup=yes,width=600,height=780']);
    assert.deepEqual(opened.navigations, ['https://journal.example/app/?popout=scratchpad']);
    assert.equal(opened.focused, 2);
  });
});

test('a second journal window finds the named capture without navigating it', async () => {
  const opened = popup('https://journal.example/app/?popout=scratchpad');
  const parent = browser(opened), { openScratchpadWindow } = await fresh('another-opener');
  await using(parent, async () => {
    assert.equal(openScratchpadWindow(), true);
    assert.equal(parent.calls.length, 1);
    assert.deepEqual(opened.navigations, []);
    assert.equal(opened.focused, 1);
  });
});

test('mobile and blocked popups select the in-app fallback', async () => {
  const { openScratchpadWindow } = await fresh('fallback');
  const mobile = browser(popup(), true);
  await using(mobile, async () => { assert.equal(openScratchpadWindow(), false); assert.equal(mobile.calls.length, 0); });
  const blocked = browser(null);
  await using(blocked, async () => { assert.equal(openScratchpadWindow(), false); assert.equal(blocked.calls.length, 1); });
  const rejected = browser(null); rejected.open = () => { throw new Error('Denied'); };
  await using(rejected, async () => { assert.equal(openScratchpadWindow(), false); });
});

test('closing a capture window allows a fresh capture window to open', async () => {
  const opened = popup(), parent = browser(opened), { openScratchpadWindow } = await fresh('closed');
  await using(parent, async () => {
    assert.equal(openScratchpadWindow(), true);
    opened.closed = true;
    const replacement = popup(); parent.open = (...args) => { parent.calls.push(args); return replacement; };
    assert.equal(openScratchpadWindow(), true);
    assert.equal(parent.calls.length, 2);
    assert.deepEqual(replacement.navigations, ['https://journal.example/app/?popout=scratchpad']);
  });
});
