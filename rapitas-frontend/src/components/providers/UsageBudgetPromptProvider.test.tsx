/**
 * UsageBudgetPromptProvider tests
 *
 * Verifies evaluate is called on mount and every 60 seconds with the local
 * timezone offset, the dialog appears only when pendingPrompt is returned,
 * a choice posts to prompt-response, failures stay silent until the next poll,
 * and unmount clears the timer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import UsageBudgetPromptProvider, { USAGE_BUDGET_POLL_MS } from './UsageBudgetPromptProvider';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const pending = {
  key: '2026-10:exceeded',
  level: 'exceeded',
  unit: 'executions',
  used: 12,
  limit: 10,
  remaining: 0,
  avg7: 2,
  daysToExhaust: 0,
  projectedMonthEnd: 40,
};

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('UsageBudgetPromptProvider', () => {
  it('evaluates on mount with the timezone offset and every 60 seconds', async () => {
    fetchMock.mockResolvedValue(okJson({ success: true, data: { pendingPrompt: null } }));
    render(<UsageBudgetPromptProvider />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://api.test/agent-metrics/usage-budget/evaluate?tzOffsetMinutes=${-new Date().getTimezoneOffset()}`,
    );
    expect(init).toMatchObject({ method: 'POST' });

    await act(async () => {
      vi.advanceTimersByTime(USAGE_BUDGET_POLL_MS);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the dialog when evaluate returns a pending prompt (exceeded does not block)', async () => {
    fetchMock.mockResolvedValue(okJson({ success: true, data: { pendingPrompt: pending } }));
    render(<UsageBudgetPromptProvider />);
    await flush();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('usageBudget.promptTitle_exceeded')).toBeInTheDocument();
  });

  it('posts the choice to prompt-response and hides the dialog on success', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('prompt-response')
          ? okJson({ success: true, data: { pendingPrompt: null } })
          : okJson({ success: true, data: { pendingPrompt: pending } }),
      ),
    );
    render(<UsageBudgetPromptProvider />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.defer' }));
    await flush();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('prompt-response'));
    expect(call?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ action: 'defer' }) });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays silent when evaluate fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<UsageBudgetPromptProvider />);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears the polling timer on unmount', async () => {
    fetchMock.mockResolvedValue(okJson({ success: true, data: { pendingPrompt: null } }));
    const { unmount } = render(<UsageBudgetPromptProvider />);
    await flush();
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(USAGE_BUDGET_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
