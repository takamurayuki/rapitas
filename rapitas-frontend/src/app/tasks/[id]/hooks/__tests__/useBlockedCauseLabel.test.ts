/**
 * useBlockedCauseLabel — the check that stopped the task reaches the detail page
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useBlockedCauseLabel } from '../useBlockedCauseLabel';

const t = (key: string, values?: Record<string, string>) => `${key}|${values?.cause ?? ''}`;
vi.mock('next-intl', () => ({ useTranslations: () => t }));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockFetch = vi.fn();
const respond = (transitions: unknown[]) =>
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, transitions }),
  });

describe('useBlockedCauseLabel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the failed checks even after a PR-not-created follow-up row', async () => {
    respond([
      { cause: 'verification_stopped', metadata: { failedChecks: ['scope', 'runtime'] } },
      { cause: 'verify_pr_not_created', metadata: {} },
    ]);

    const { result } = renderHook(() => useBlockedCauseLabel(7, true));

    await waitFor(() =>
      expect(result.current).toBe(
        'statusIndicator.blockedCauseUnknown|verification_stopped: scope, runtime',
      ),
    );
  });

  it('stays null with no history and does not fetch while not blocked', async () => {
    respond([]);

    const idle = renderHook(() => useBlockedCauseLabel(7, false));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(idle.result.current).toBeNull();

    const { result } = renderHook(() => useBlockedCauseLabel(7, true));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });
});
