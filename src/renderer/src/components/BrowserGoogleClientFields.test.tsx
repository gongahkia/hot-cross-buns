import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { GoogleSetupHelp } from './BrowserGoogleClientFields';
afterEach(cleanup);
it('dismisses setup help before an older parent document Escape listener', async () => {
  render(<GoogleSetupHelp />);
  const parent = vi.fn();
  document.addEventListener('keydown', parent, true);
  try {
    const trigger = screen.getByRole('button', { name: 'Connect' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Google Cloud setup' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(parent).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  } finally { document.removeEventListener('keydown', parent, true); }
});
