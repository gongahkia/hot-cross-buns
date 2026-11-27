import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installSmoothCaret } from '../public/caret.mjs';

test('caret follows collapsed selections and restores native behavior for selection, composition, and reduced motion', async () => {
  const dom = new JSDOM('<textarea id="message">first line\nsecond line</textarea><input type="password" value="private">', { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.ResizeObserver = class { observe() {} };
  const changes = [];
  const reduced = { matches: false, addEventListener: (_, listener) => changes.push(listener) };
  window.matchMedia = query => query.includes('reduced-motion') ? reduced : { matches: false };
  const field = document.querySelector('textarea');
  field.style.cssText = 'font-size:16px;line-height:24px;padding:4px;border:1px solid;';
  Object.defineProperties(field, {
    clientWidth: { value: 200 }, clientHeight: { value: 80 }, clientLeft: { value: 1 }, clientTop: { value: 1 },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function() {
    if (this === field) return { left: 20, top: 40, width: 202, height: 82 };
    if (this.classList.contains('caret-mirror')) return { left: -100000, top: 0 };
    if (this.parentElement?.classList.contains('caret-mirror')) return { left: -100000 + this.previousSibling.textContent.length * 8, top: 4 };
    return { left: 0, top: 0, width: 0, height: 0 };
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 15));
  installSmoothCaret();
  field.focus();
  field.setSelectionRange(2, 2);
  await tick();
  const caret = document.querySelector('.smooth-caret');
  assert.equal(caret.hidden, false);
  const original = caret.style.transform;
  field.setSelectionRange(5, 5);
  field.dispatchEvent(new window.Event('keyup', { bubbles: true }));
  await tick();
  assert.notEqual(caret.style.transform, original);
  assert.equal(field.value, 'first line\nsecond line');
  field.setSelectionRange(1, 5);
  field.dispatchEvent(new window.Event('select', { bubbles: true }));
  document.dispatchEvent(new window.Event('selectionchange'));
  await tick();
  assert.equal(caret.hidden, true);
  assert.equal(field.classList.contains('smooth-caret-field'), false);
  field.setSelectionRange(5, 5);
  field.dispatchEvent(new window.Event('compositionstart', { bubbles: true }));
  await tick();
  assert.equal(caret.hidden, true);
  field.dispatchEvent(new window.Event('compositionend', { bubbles: true }));
  await tick();
  assert.equal(caret.hidden, false);
  reduced.matches = true;
  changes.forEach(listener => listener());
  assert.equal(caret.hidden, true);
  assert.equal(field.classList.contains('smooth-caret-field'), false);
  reduced.matches = false;
  document.querySelector('input').focus();
  await tick();
  assert.equal(caret.hidden, true);
  assert.doesNotMatch(document.querySelector('.caret-mirror').textContent, /private/);
  dom.window.close();
});


test('search caret stays inside the popover top layer instead of disappearing behind it',async()=>{
  const dom=new JSDOM('<aside popover="auto"><input type="search" value="meiji"></aside>',{pretendToBeVisual:true});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.Node=dom.window.Node;globalThis.getComputedStyle=dom.window.getComputedStyle;
  globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.ResizeObserver=class{observe(){}};
  window.matchMedia=()=>({matches:false,addEventListener(){}});
  const field=document.querySelector('input'),popup=document.querySelector('aside');field.style.cssText='font-size:13px;line-height:20px;';
  Object.defineProperties(field,{clientWidth:{value:200},clientHeight:{value:24}});
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this===field)return {left:120,top:80,width:200,height:24};
    if(this===popup)return {left:100,top:40,width:240,height:180};
    if(this.classList.contains('caret-mirror'))return {left:-100000,top:0};
    if(this.parentElement?.classList.contains('caret-mirror'))return {left:-100000+this.previousSibling.textContent.length*7,top:3};
    return {left:0,top:0,width:0,height:0};
  };
  popup.style.display='block';
  installSmoothCaret();field.focus();field.setSelectionRange(5,5);await new Promise(resolve=>setTimeout(resolve,20));
  const caret=document.querySelector('.smooth-caret');assert.equal(caret.parentElement,popup);assert.equal(caret.hidden,false);assert.equal(caret.style.position,'absolute');
  assert.match(caret.style.transform,/translate3d\(55px,\s*43px,\s*0(?:px)?\)/);
  field.blur();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(field.classList.contains('smooth-caret-field'),false);
  dom.window.close();
});
