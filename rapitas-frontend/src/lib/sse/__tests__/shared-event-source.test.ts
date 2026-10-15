/**
 * shared-event-source.test.ts
 *
 * 共有EventSourceマネージャの検証: 複数購読でも接続が1本であること（接続枯渇
 * 対策の核心）、イベント種別ごとのディスパッチ、購読解除、接続状態通知。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

/** Minimal EventSource stub recording instances and listeners. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.forEach((fn) => fn({ data: JSON.stringify(data) } as MessageEvent));
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

/**
 * Fake `document` isolated per test. The manager's constructor attaches a
 * permanent `visibilitychange` listener with no way to detach it; reusing the
 * real jsdom `document` across tests (each with its own module instance from
 * `vi.resetModules()`) would leave every prior test's listener still firing on
 * later `dispatchEvent` calls. A fresh EventTarget per test avoids that leak.
 */
class FakeDocument extends EventTarget {
  hidden = false;
}

describe('SharedEventSourceManager', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', new FakeDocument());
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@tauri-apps/api/event');
    vi.unstubAllGlobals();
  });

  it('複数の購読でも EventSource は1本だけ開くこと', async () => {
    const { sharedEventSource } = await import('../shared-event-source');

    sharedEventSource.subscribe('shutdown', () => {});
    sharedEventSource.subscribe('new_notification', () => {});
    sharedEventSource.subscribe('new_notification', () => {});

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('http://test:3001/events/subscribe/*');
  });

  it('イベント種別ごとに該当ハンドラへディスパッチすること', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    const onShutdown = vi.fn();
    const onNotify = vi.fn();

    sharedEventSource.subscribe('shutdown', onShutdown);
    sharedEventSource.subscribe('new_notification', onNotify);

    FakeEventSource.instances[0].emit('new_notification', { unreadCount: 2 });

    expect(onNotify).toHaveBeenCalledTimes(1);
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it('購読解除後はハンドラが呼ばれず、接続は維持されること', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    const handler = vi.fn();

    const unsubscribe = sharedEventSource.subscribe('shutdown', handler);
    unsubscribe();
    FakeEventSource.instances[0].emit('shutdown', {});

    expect(handler).not.toHaveBeenCalled();
    expect(FakeEventSource.instances[0].readyState).not.toBe(FakeEventSource.CLOSED);
  });

  it('接続状態の変化を onConnectionChange へ通知すること（即時初期値＋onopen）', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    sharedEventSource.subscribe('shutdown', () => {});

    const states: boolean[] = [];
    sharedEventSource.onConnectionChange((c) => states.push(c));

    FakeEventSource.instances[0].onopen?.();

    expect(states).toEqual([false, true]);
    expect(sharedEventSource.isConnected()).toBe(true);
  });

  it('ハンドラが例外を投げても他のハンドラへの配送は継続すること', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();

    sharedEventSource.subscribe('shutdown', bad);
    sharedEventSource.subscribe('shutdown', good);
    FakeEventSource.instances[0].emit('shutdown', {});

    expect(good).toHaveBeenCalledTimes(1);
  });

  it('onConnectionChange の解除関数はリスナーを削除すること', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    sharedEventSource.subscribe('shutdown', () => {});

    const listener = vi.fn();
    const unsubscribe = sharedEventSource.onConnectionChange(listener);
    listener.mockClear(); // drop the immediate initial-state call

    unsubscribe();
    FakeEventSource.instances[0].onopen?.();

    expect(listener).not.toHaveBeenCalled();
  });

  it('接続状態リスナーが例外を投げても他のリスナーへの通知は継続すること', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    sharedEventSource.subscribe('shutdown', () => {});

    const bad = vi.fn(() => {
      throw new Error('listener boom');
    });
    const good = vi.fn();
    // The immediate call inside onConnectionChange (with the current state) is
    // not wrapped in try/catch, so registering a throwing listener throws here —
    // it is still added to the internal set before that happens.
    expect(() => sharedEventSource.onConnectionChange(bad)).toThrow('listener boom');
    sharedEventSource.onConnectionChange(good);
    good.mockClear();

    // The later dispatch loop (inside setConnected) IS wrapped per-listener, so
    // `bad` throwing here must not prevent `good` from being notified.
    FakeEventSource.instances[0].onopen?.();

    expect(good).toHaveBeenCalledWith(true);
  });

  it('ページが隠れると接続を閉じ、再び表示されると再接続すること', async () => {
    const { sharedEventSource } = await import('../shared-event-source');
    sharedEventSource.subscribe('shutdown', () => {});
    expect(FakeEventSource.instances).toHaveLength(1);

    (document as unknown as { hidden: boolean }).hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));

    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED);

    (document as unknown as { hidden: boolean }).hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));

    // A fresh EventSource is opened, and the previously-bound event type is re-attached.
    expect(FakeEventSource.instances).toHaveLength(2);
    const onNotify = vi.fn();
    sharedEventSource.subscribe('shutdown', onNotify);
    FakeEventSource.instances[1].emit('shutdown', {});
    expect(onNotify).toHaveBeenCalledTimes(1);
  });

  it('隠れている間はスケジュールされた再接続をキャンセルすること', async () => {
    vi.useFakeTimers();
    try {
      const { sharedEventSource } = await import('../shared-event-source');
      sharedEventSource.subscribe('shutdown', () => {});

      const es = FakeEventSource.instances[0];
      es.readyState = FakeEventSource.CLOSED;
      es.onerror?.();
      // A reconnect got scheduled by onerror (readyState CLOSED).

      (document as unknown as { hidden: boolean }).hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));

      vi.advanceTimersByTime(10000);
      // Hidden should have cancelled the pending reconnect timer, so no new
      // connection is opened even though the delay has elapsed.
      expect(FakeEventSource.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('onerror で readyState が CLOSED のとき再接続をスケジュールすること', async () => {
    vi.useFakeTimers();
    try {
      const { sharedEventSource } = await import('../shared-event-source');
      sharedEventSource.subscribe('shutdown', () => {});

      const es = FakeEventSource.instances[0];
      es.readyState = FakeEventSource.CLOSED;
      es.onerror?.();

      expect(sharedEventSource.isConnected()).toBe(false);
      expect(FakeEventSource.instances).toHaveLength(1);

      vi.advanceTimersByTime(5000);

      expect(FakeEventSource.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('onerror で readyState が CLOSED でなければ再接続をスケジュールしないこと', async () => {
    vi.useFakeTimers();
    try {
      const { sharedEventSource } = await import('../shared-event-source');
      sharedEventSource.subscribe('shutdown', () => {});

      const es = FakeEventSource.instances[0];
      es.readyState = FakeEventSource.CONNECTING;
      es.onerror?.();

      vi.advanceTimersByTime(10000);

      expect(FakeEventSource.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Tauri環境では window-hide/window-show イベントで一時停止・再開すること', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const mockListen = vi.fn(async (_event: string, _cb: (e: unknown) => void) => () => {});
    vi.doMock('@tauri-apps/api/event', () => ({ listen: mockListen }));

    const { sharedEventSource } = await import('../shared-event-source');
    sharedEventSource.subscribe('shutdown', () => {});

    // Flush the fire-and-forget setupTauriVisibilityListener() dynamic import —
    // it resolves via a real dynamic-import tick, not just microtasks, so a
    // short real-timer wait is needed rather than chained Promise.resolve().
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockListen).toHaveBeenCalledWith('rapitas:window-hide', expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith('rapitas:window-show', expect.any(Function));

    const hideCallback = mockListen.mock.calls.find((c) => c[0] === 'rapitas:window-hide')?.[1] as (
      e: unknown,
    ) => void;
    const showCallback = mockListen.mock.calls.find((c) => c[0] === 'rapitas:window-show')?.[1] as (
      e: unknown,
    ) => void;

    expect(FakeEventSource.instances).toHaveLength(1);
    hideCallback(null);
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED);

    showCallback(null);
    expect(FakeEventSource.instances).toHaveLength(2);

    vi.doUnmock('@tauri-apps/api/event');
  });
});
