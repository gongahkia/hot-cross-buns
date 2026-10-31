import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { AppDialogHost } from './AppDialogHost';
import { alertInApp, cancelAppDialogs, confirmInApp } from './appDialogs';

afterEach(() => { cleanup(); cancelAppDialogs(); });
it('waits for a choice, defaults to Cancel, and resolves only once', async () => {
  render(<AppDialogHost />);
  let choice: Promise<boolean>;
  act(() => { choice = confirmInApp('Reset Google checkpoints?', { title: 'Full resync', confirmLabel: 'Resync' }); });
  expect(screen.getByRole('alertdialog', { name: 'Full resync' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Resync' }));
  expect(await choice!).toBe(true);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
it('Escape cancels and returns focus to the trigger', async () => {
  render(<><button>Trigger</button><AppDialogHost /></>);
  const trigger = screen.getByRole('button', { name: 'Trigger' }); trigger.focus();
  let choice: Promise<boolean>;
  act(() => { choice = confirmInApp('Delete a list?'); });
  await userEvent.keyboard('{Escape}');
  expect(await choice!).toBe(false);
  expect(trigger).toHaveFocus();
});
it('queues notices without overwriting a pending confirmation', async () => {
  render(<AppDialogHost />);
  let choice: Promise<boolean>, notice: Promise<void>;
  act(() => { choice = confirmInApp('Delete?'); notice = alertInApp('Copy failed.'); });
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete?');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await choice!).toBe(false);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Copy failed.');
  await userEvent.click(screen.getByRole('button', { name: 'Okay' }));
  await notice!;
});
it('cancels outstanding requests when the application host unmounts', async () => {
  const view = render(<AppDialogHost />);
  let choice: Promise<boolean>;
  act(() => { choice = confirmInApp('Delete this list?'); });
  view.unmount();
  expect(await choice!).toBe(false);
});
