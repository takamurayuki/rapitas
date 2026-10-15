/**
 * UsageBudgetPromptDialog tests
 *
 * Verifies the 続行 / 後回し / 上限変更 choices each call the API exactly once,
 * the dialog closes only on success, Esc closes without any API call, the
 * change-limit button is enabled only for a positive integer, and the
 * forecast remaining is shown.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UsageBudgetPromptDialog, type PendingPrompt } from './UsageBudgetPromptDialog';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}.${key}:${JSON.stringify(params)}` : `${ns}.${key}`,
}));

const prompt: PendingPrompt = {
  key: '2026-10:warn80',
  level: 'warn80',
  unit: 'tokens',
  used: 800,
  limit: 1000,
  remaining: 200,
  avg7: 50,
  daysToExhaust: 4,
  projectedMonthEnd: 1300,
};

function setup(respond = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const onResolved = vi.fn();
  render(
    <UsageBudgetPromptDialog
      prompt={prompt}
      respond={respond}
      onClose={onClose}
      onResolved={onResolved}
    />,
  );
  return { respond, onClose, onResolved };
}

describe('UsageBudgetPromptDialog', () => {
  it('shows the level title and the forecast remaining', () => {
    setup();
    expect(screen.getByText('usageBudget.promptTitle_warn80')).toBeInTheDocument();
    expect(screen.getByText(/usageBudget\.promptForecast/)).toHaveTextContent('"days":"4"');
    expect(screen.getByText(/usageBudget\.promptUsage/)).toBeInTheDocument();
  });

  it('continue calls the API once and resolves', async () => {
    const { respond, onResolved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.continue' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({ action: 'continue' });
  });

  it('defer calls the API once and resolves', async () => {
    const { respond, onResolved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.defer' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(respond).toHaveBeenCalledWith({ action: 'defer' });
  });

  it('change limit is enabled only for a positive integer and sends the new limit', async () => {
    const { respond, onResolved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.changeLimit' }));
    const input = screen.getByLabelText('usageBudget.newLimit');
    const apply = screen.getByRole('button', { name: 'usageBudget.applyLimit' });

    fireEvent.change(input, { target: { value: '0' } });
    expect(apply).toBeDisabled();
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(apply).toBeDisabled();
    fireEvent.change(input, { target: { value: '2000' } });
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({ action: 'change_limit', monthlyLimit: 2000 });
  });

  it('stays open with an error when the API fails', async () => {
    const { onResolved, onClose } = setup(vi.fn().mockRejectedValue(new Error('500')));
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('usageBudget.actionFailed');
    expect(onResolved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Esc closes without calling the API', () => {
    const { respond, onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(respond).not.toHaveBeenCalled();
  });

  it('renders nothing without a prompt', () => {
    render(
      <UsageBudgetPromptDialog
        prompt={null}
        respond={vi.fn()}
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
