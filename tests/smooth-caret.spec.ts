import { runCommand } from './commands';
import { expect, test, type Locator, type Page } from '@playwright/test';

const caret = (page: Page) => page.locator('[data-moving-caret]');
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function target(page: Page) {
  return caret(page).evaluate(element => {
    const matrix = new DOMMatrixReadOnly((element as HTMLElement).style.transform);
    return { x: matrix.m41, y: matrix.m42, height: element.getBoundingClientRect().height };
  });
}
async function search(page: Page, value = 'Caret') {
  await page.goto('/');
  await runCommand(page, 'Open search');
  const input = page.getByRole('combobox', { name: 'Search commands and journal' });
  await input.fill(value);
  await expect(input).toHaveAttribute('data-smooth-caret', 'true');
  return input;
}
async function scratchpad(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Scratchpad text', exact: true });
  await input.evaluate(element => {
    element.style.fontFamily = 'monospace'; element.style.fontSize = '16px';
    element.style.lineHeight = '24px'; element.style.tabSize = '4';
  });
  return input;
}
async function visiblePosition(page: Page, input: Locator) {
  await expect(input).toHaveAttribute('data-smooth-caret', 'true');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const position = await target(page);
  const box = (await input.boundingBox())!;
  expect(position.x).toBeGreaterThanOrEqual(box.x);
  expect(position.x).toBeLessThan(box.x + box.width);
  expect(position.y).toBeGreaterThanOrEqual(box.y);
  expect(position.y + position.height).toBeLessThanOrEqual(box.y + box.height + 1);
  return position;
}

test('typing produces a real position transition with a snappy settle', async ({ page }) => {
  const input = await search(page);
  const before = await target(page);
  await caret(page).evaluate(element => {
    const control = Object.assign(window, { smoothCaretSample: null as { middle: number; destination: number; duration: number } | null });
    element.addEventListener('transitionrun', () => {
      const move = element.getAnimations().find(animation => animation instanceof CSSTransition && animation.transitionProperty === 'transform')!;
      move.pause(); move.currentTime = 30;
      control.smoothCaretSample = {
        middle: element.getBoundingClientRect().left,
        duration: Number(move.effect!.getComputedTiming().duration),
        destination: new DOMMatrixReadOnly((element as HTMLElement).style.transform).m41,
      };
      move.finish();
    }, { once: true });
  });
  await input.press('x');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'smoothCaretSample'))).not.toBeNull();
  const animation = await page.evaluate(() => Reflect.get(window, 'smoothCaretSample')) as { middle: number; destination: number; duration: number };
  expect(animation.duration).toBe(110);
  expect(animation.middle).toBeGreaterThan(before.x);
  expect(animation.middle).toBeLessThan(animation.destination);
  await expect(input).toHaveValue('Caretx');
  await expect(caret(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(caret(page)).toHaveCSS('pointer-events', 'none');
});

test('arrow navigation stays aligned with proportional text and native selection', async ({ page }) => {
  const input = await search(page, 'Proportional text');
  await input.press('Home');
  await visiblePosition(page, input);
  expect(await input.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(0);
  const expected = await input.evaluate(element => {
    const field = element as HTMLInputElement;
    const style = getComputedStyle(field);
    return field.getBoundingClientRect().left + field.clientLeft + parseFloat(style.paddingLeft) - field.scrollLeft;
  });
  await expect.poll(async () => (await target(page)).x).toBeCloseTo(expected, 0);
  await input.press('End');
  await input.press('Shift+Home');
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  expect(await input.evaluate(element => (element as HTMLInputElement).selectionEnd)).toBe('Proportional text'.length);
  await input.press('ArrowRight');
  await visiblePosition(page, input);
  await expect(input).toHaveValue('Proportional text');
});

test('multiline text, tabs and Unicode use the actual insertion position', async ({ page }) => {
  const input = await scratchpad(page);
  await input.fill('first');
  const first = await visiblePosition(page, input);
  await input.press('Enter');
  await input.press('x');
  await expect.poll(async () => (await target(page)).y - first.y).toBeCloseTo(24, 0);
  await input.fill('xx\ty');
  await input.press('ArrowLeft');
  await expect(input).toHaveAttribute('data-smooth-caret', 'true');
  const tabExpected = await input.evaluate(element => {
    const field = element as HTMLTextAreaElement; const style = getComputedStyle(field);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return field.getBoundingClientRect().left + parseFloat(style.paddingLeft) + context.measureText('    ').width;
  });
  await expect.poll(async () => (await target(page)).x).toBeCloseTo(tabExpected, 0);
  await input.fill('A👋e\u0301');
  await input.press('ArrowLeft');
  expect(await input.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(3);
  await visiblePosition(page, input);
  await expect(input).toHaveValue('A👋e\u0301');
});

test('long single-line inputs track horizontal scroll without losing text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const value = 'A long journal search with proportional letters '.repeat(8);
  const input = await search(page, value);
  await input.press('End');
  await expect.poll(() => input.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await visiblePosition(page, input);
  const expected = await input.evaluate(element => {
    const field = element as HTMLInputElement; const style = getComputedStyle(field);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return field.getBoundingClientRect().left + parseFloat(style.paddingLeft) + context.measureText(field.value).width - field.scrollLeft;
  });
  await expect.poll(async () => (await target(page)).x).toBeCloseTo(expected, 0);
  await input.press('Home');
  await expect.poll(() => input.evaluate(element => element.scrollLeft)).toBe(0);
  await visiblePosition(page, input);
  await expect(input).toHaveValue(value);
});

test('wrapping and textarea scrolling keep the caret inside the editor', async ({ page }) => {
  const input = await scratchpad(page);
  await input.fill('wrapping words '.repeat(15));
  const wide = await visiblePosition(page, input);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(async () => (await target(page)).y).toBeGreaterThan(wide.y);
  await visiblePosition(page, input);
  await input.evaluate(element => {
    element.style.height = '120px'; element.style.minHeight = '0'; element.style.flex = 'none';
  });
  await input.fill(Array.from({ length: 50 }, (_, index) => 'line ' + index).join('\n'));
  await input.evaluate(element => {
    const field = element as HTMLTextAreaElement;
    const index = field.value.indexOf('line 20');
    field.setSelectionRange(index, index); field.scrollTop = 450;
  });
  const scrolled = await visiblePosition(page, input);
  await input.evaluate(element => { element.scrollTop += 12; });
  await expect.poll(async () => (await target(page)).y).toBeCloseTo(scrolled.y - 12, 0);
  await input.evaluate(element => { element.scrollTop = 0; });
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  await expect(caret(page)).toBeHidden();
});

test('the caret appears above native dialogs and stops during composition', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({
    name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from('2026-11-16\nMissing divider\n'),
  });
  const input = page.getByRole('textbox', { name: 'Edit imported TODO.txt', exact: true });
  await input.focus();
  await visiblePosition(page, input);
  expect(await caret(page).evaluate(element => element.matches(':popover-open'))).toBe(true);
  await input.dispatchEvent('compositionstart', { data: 'に' });
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  await expect(caret(page)).toBeHidden();
  await input.dispatchEvent('compositionend', { data: '日本' });
  await visiblePosition(page, input);
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  await expect(caret(page)).toBeHidden();
});

test('large text and bidirectional content retain their native caret', async ({ page }) => {
  const input = await scratchpad(page);
  await input.fill('x'.repeat(32_769));
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  await expect(caret(page)).toBeHidden();
  await expect(input).toHaveValue('x'.repeat(32_769));
  await input.fill('مرحبا');
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  await input.fill('Editable again');
  await visiblePosition(page, input);
  await input.evaluate(element => { (element as HTMLTextAreaElement).readOnly = true; });
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
});

test('reduced motion and forced colors immediately restore the native caret', async ({ page }) => {
  const input = await search(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  await expect(caret(page)).toBeHidden();
  await input.press('x');
  await expect(input).toHaveValue('Caretx');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await visiblePosition(page, input);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
  await expect(caret(page)).toBeHidden();
});

test('passwords and segmented inputs use native editing without mirrored carets', async ({ page }) => {
  await search(page);
  await runCommand(page, 'Close search');
  await page.evaluate(() => {
    for (const type of ['password', 'number', 'date']) {
      const input = document.createElement('input'); input.type = type;
      input.setAttribute('aria-label', 'Native ' + type); document.body.append(input);
    }
  });
  for (const [type, value] of [['password', 'Keep this private'], ['number', '41'], ['date', '2026-11-16']]) {
    const input = page.getByLabel('Native ' + type, { exact: true });
    await input.fill(value);
    await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
    await expect(caret(page)).toBeHidden();
    await expect(input).toHaveValue(value);
  }
  const number = page.getByLabel('Native number', { exact: true });
  await number.focus(); await number.press('ArrowUp');
  await expect(number).toHaveValue('42');
});

test.describe('touch input', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 375, height: 812 } });
  test('touch selection stays native and typing resumes animated movement', async ({ page }) => {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: 'New daily item', exact: true });
    await input.tap();
    await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
    await input.pressSequentially('Typing', { delay: 40 });
    await visiblePosition(page, input);
    await input.tap();
    await expect(input).not.toHaveAttribute('data-smooth-caret', 'true');
    await input.press('Backspace');
    await visiblePosition(page, input);
  });
});
