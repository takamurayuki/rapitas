import { renderHook, act, waitFor } from '@testing-library/react';
import { useBrowserNotifications } from '../common/useBrowserNotifications';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorThrottled: vi.fn(),
  }),
}));

const mockSubscribe = vi.fn();
vi.mock('@/lib/sse/shared-event-source', () => ({
  sharedEventSource: {
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
  },
}));

describe('useBrowserNotifications', () => {
  const originalNotification = window.Notification;

  beforeEach(() => {
    mockSubscribe.mockReset().mockReturnValue(() => {});
  });

  afterEach(() => {
    window.Notification = originalNotification;
    vi.restoreAllMocks();
  });

  it('subscribes to new_notification on the shared SSE connection', () => {
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'granted';
      constructor() {}
      close() {}
    };
    renderHook(() => useBrowserNotifications());
    expect(mockSubscribe).toHaveBeenCalledWith('new_notification', expect.any(Function));
  });

  it('does not subscribe when disabled', () => {
    renderHook(() => useBrowserNotifications({ enabled: false }));
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('requests permission on mount when Notification API exists and permission is default', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'default';
      static requestPermission = requestPermission;
      constructor() {}
      close() {}
    };

    const { result } = renderHook(() => useBrowserNotifications());
    await waitFor(() => expect(result.current.permission).toBe('granted'));
    expect(requestPermission).toHaveBeenCalled();
  });

  it('updates unreadCount and invokes onNotification when an event arrives', () => {
    let handler: ((event: MessageEvent) => void) | undefined;
    mockSubscribe.mockImplementation((_type: string, fn: (event: MessageEvent) => void) => {
      handler = fn;
      return () => {};
    });
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'denied'; // avoid actually constructing a notification
      constructor() {}
      close() {}
    };
    const onNotification = vi.fn();

    const { result } = renderHook(() => useBrowserNotifications({ onNotification }));

    act(() => {
      handler?.({
        data: JSON.stringify({
          notification: { id: 1, type: 'info', title: 'T', message: 'M' },
          unreadCount: 3,
        }),
      } as MessageEvent);
    });

    expect(result.current.unreadCount).toBe(3);
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ unreadCount: 3 }));
  });

  it('does not show a native notification when the window has focus', () => {
    let handler: ((event: MessageEvent) => void) | undefined;
    mockSubscribe.mockImplementation((_type: string, fn: (event: MessageEvent) => void) => {
      handler = fn;
      return () => {};
    });
    const ctorSpy = vi.fn();
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'granted';
      constructor(...args: unknown[]) {
        ctorSpy(...args);
      }
      close() {}
    };
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    renderHook(() => useBrowserNotifications());
    act(() => {
      handler?.({
        data: JSON.stringify({
          notification: { id: 2, type: 'info', title: 'T', message: 'M' },
          unreadCount: 1,
        }),
      } as MessageEvent);
    });

    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('shows a native notification when unfocused and permission granted', () => {
    let handler: ((event: MessageEvent) => void) | undefined;
    mockSubscribe.mockImplementation((_type: string, fn: (event: MessageEvent) => void) => {
      handler = fn;
      return () => {};
    });
    const ctorSpy = vi.fn();
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'granted';
      constructor(...args: unknown[]) {
        ctorSpy(...args);
      }
      close() {}
    };
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    renderHook(() => useBrowserNotifications());
    act(() => {
      handler?.({
        data: JSON.stringify({
          notification: { id: 3, type: 'info', title: 'Hello', message: 'World' },
          unreadCount: 1,
        }),
      } as MessageEvent);
    });

    expect(ctorSpy).toHaveBeenCalledWith('Hello', expect.objectContaining({ body: 'World' }));
  });

  it('gracefully ignores malformed event payloads', () => {
    let handler: ((event: MessageEvent) => void) | undefined;
    mockSubscribe.mockImplementation((_type: string, fn: (event: MessageEvent) => void) => {
      handler = fn;
      return () => {};
    });
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'granted';
      constructor() {}
      close() {}
    };

    const { result } = renderHook(() => useBrowserNotifications());
    expect(() => {
      act(() => {
        handler?.({ data: 'not-json' } as MessageEvent);
      });
    }).not.toThrow();
    expect(result.current.unreadCount).toBe(0);
  });

  it('unsubscribes on unmount', () => {
    const unsub = vi.fn();
    mockSubscribe.mockReturnValue(unsub);
    // @ts-expect-error minimal Notification mock
    window.Notification = class {
      static permission = 'granted';
      constructor() {}
      close() {}
    };

    const { unmount } = renderHook(() => useBrowserNotifications());
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
