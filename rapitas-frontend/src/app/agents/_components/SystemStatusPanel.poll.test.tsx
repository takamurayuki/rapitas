/**
 * SystemStatusPanel.poll.test
 *
 * Task 1553 R3: the system-status polls on /agents (SystemStatusPanel's
 * /health poll and use-resource-gate's status poll) stretch from 10 s to
 * 40 s while rapitas is in the background, and return to 10 s when it comes
 * back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { SystemStatusPanel } from './SystemStatusPanel';
import { useResourceGate } from './use-resource-gate';
import { setAppHidden } from '@/hooks/common/app-visibility-store';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

function intervalDelays(spy: ReturnType<typeof vi.spyOn>): number[] {
  return spy.mock.calls.map((c: unknown[]) => c[1] as number);
}

describe('system-status polling while hidden (task 1553 R3)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    setDocumentHidden(false);
    setAppHidden(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('SystemStatusPanel: 40 s timer while hidden, no /health probe at 10 s, 10 s again on return', async () => {
    setDocumentHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(intervalDelays(spy)).toContain(40_000);
    expect(intervalDelays(spy)).not.toContain(10_000);
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      setDocumentHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(intervalDelays(spy).at(-1)).toBe(10_000);
    expect(mockFetch).toHaveBeenCalledTimes(1); // the useOnVisible refresh only
  });

  it('use-resource-gate: 40 s timer while minimized, 10 s after restore', async () => {
    setAppHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useResourceGate());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(intervalDelays(spy)).toContain(40_000);
    expect(intervalDelays(spy)).not.toContain(10_000);
    const callsWhileHidden = mockFetch.mock.calls.length; // initial load only (status + deferrals)
    expect(callsWhileHidden).toBe(2);

    await act(async () => {
      setAppHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(intervalDelays(spy).at(-1)).toBe(10_000);
  });
});
