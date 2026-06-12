/**
 * shared-event-source.test.ts
 *
 * 共有EventSourceマネージャの検証: 複数購読でも接続が1本であること（接続枯渇
 * 対策の核心）、イベント種別ごとのディスパッチ、購読解除、接続状態通知。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('SharedEventSourceManager', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('window', {});
    vi.resetModules();
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
});
