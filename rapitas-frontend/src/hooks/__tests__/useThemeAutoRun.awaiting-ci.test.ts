/**
 * useThemeAutoRun.awaiting-ci.test
 *
 * The hook keeps the response's CI-wait list, and reads an older backend that
 * sends none (task 1570).
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useThemeAutoRun } from '../workflow/useThemeAutoRun';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const autoRun = { status: 'idle', startedAt: null };
const entry = {
  taskId: 7,
  title: 'task 7',
  cause: 'verify_awaiting_required_merge',
  since: '2026-11-28T00:00:00.000Z',
};

function stubResponse(extra: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, autoRun, currentTask: null, ...extra }),
    }),
  );
}

describe('useThemeAutoRun — awaitingCi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the CI-wait list from the response', async () => {
    stubResponse({ awaitingCi: [entry] });
    const { result } = renderHook(() => useThemeAutoRun(5, true));

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.awaitingCi).toEqual([entry]);
  });

  it('leaves it undefined for a response without the field', async () => {
    stubResponse({});
    const { result } = renderHook(() => useThemeAutoRun(5, true));

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.awaitingCi).toBeUndefined();
  });
});
