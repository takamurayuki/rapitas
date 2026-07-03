import { renderHook, act } from '@testing-library/react';
import { useScheduleReminders } from '../feature/useScheduleReminders';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslations: () => t };
});
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockRequestPermission = vi.fn();
const mockShowNotification = vi.fn();
vi.mock('@/utils/notification', () => ({
  requestNotificationPermission: (...args: unknown[]) => mockRequestPermission(...args),
  showDesktopNotification: (...args: unknown[]) => mockShowNotification(...args),
}));

describe('useScheduleReminders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRequestPermission.mockReset().mockResolvedValue(true);
    mockShowNotification.mockReset();
    useLocaleStore.setState({ locale: 'ja' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('requests notification permission and checks reminders on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
    );

    renderHook(() => useScheduleReminders());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it('shows a desktop notification for each pending reminder and marks it sent', async () => {
    const events = [
      { id: 1, title: 'Standup', startAt: '2026-01-01T09:00:00.000Z', isAllDay: false },
    ];
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/reminders/pending')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(events) });
      }
      // "sent" marker call
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useScheduleReminders());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mockShowNotification).toHaveBeenCalledWith(
      'Rapitas - Standup',
      expect.objectContaining({ tag: 'schedule-reminder-1' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/schedules/reminders/1/sent',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not throw when the reminders fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    expect(() => {
      renderHook(() => useScheduleReminders());
    }).not.toThrow();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('does not throw when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    renderHook(() => useScheduleReminders());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('clears the interval on unmount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
    );
    const clearSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() => useScheduleReminders());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});
