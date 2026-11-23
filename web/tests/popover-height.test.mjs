import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { animatePopoverHeight } from '../public/popover-height.mjs';

function fixture() {
  const dom = new JSDOM('<aside><header>Tasks</header></aside>');
  const view = dom.window, root = view.document.querySelector('aside');
  let observe, observed = false, pending, next = 1, contentHeight = 90, limit = 300;
  view.ResizeObserver = class {
    constructor(callback) { observe = callback; }
    observe() { observed = true; }
    disconnect() { observed = false; }
  };
  view.requestAnimationFrame = callback => { pending = callback; return next++; };
  view.cancelAnimationFrame = () => { pending = undefined; };
  view.getComputedStyle = () => ({ paddingTop: '10px', paddingBottom: '10px', borderTopWidth: '1px', borderBottomWidth: '1px', maxHeight: limit + 'px' });
  animatePopoverHeight(root);
  root.firstElementChild.getBoundingClientRect = () => ({ height: contentHeight });
  const toggle = (name, state, target = root) => {
    const event = new view.Event(name, { bubbles: true }); Object.defineProperty(event, 'newState', { value: state }); target.dispatchEvent(event);
  };
  return { root, view, dom,
    open() { toggle('beforetoggle', 'open'); toggle('toggle', 'open'); },
    close() { toggle('beforetoggle', 'closed'); toggle('toggle', 'closed'); },
    resize(height) { contentHeight = height; if (observed) observe(); },
    limit(value) { limit = value; view.dispatchEvent(new view.Event('resize')); },
    nested(state) { toggle('toggle', state, root.querySelector('header')); },
    frame() { const callback = pending; pending = undefined; callback?.(); },
  };
}

test('popover measurement follows content changes, coalesces updates, and caps both growth and shrinkage', () => {
  const f = fixture();
  try {
    f.open(); assert.equal(f.root.style.height, '112px');
    f.resize(200); f.resize(240); assert.equal(f.root.style.height, '112px');
    f.frame(); assert.equal(f.root.style.height, '262px');
    f.resize(700); f.frame(); assert.equal(f.root.style.height, '300px');
    f.resize(100); f.frame(); assert.equal(f.root.style.height, '122px');
    f.limit(80); f.frame(); assert.equal(f.root.style.height, '80px');
    f.limit(300); f.frame(); assert.equal(f.root.style.height, '122px');
  } finally { f.dom.window.close(); }
});

test('closing cancels pending measurements and reopening measures the current content without stale height', () => {
  const f = fixture();
  try {
    f.open(); f.resize(200); f.close(); f.frame();
    assert.equal(f.root.style.height, '112px');
    f.resize(60); f.open(); assert.equal(f.root.style.height, '82px');
    f.nested('closed'); f.resize(120); f.frame(); assert.equal(f.root.style.height, '142px');
    f.root.remove(); f.resize(200); f.frame(); assert.equal(f.root.style.height, '142px');
  } finally { f.dom.window.close(); }
});
