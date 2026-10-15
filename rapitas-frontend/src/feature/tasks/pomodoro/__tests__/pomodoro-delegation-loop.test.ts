/**
 * The float window must not handle the delegation event it emits.
 *
 * pomodoro-store.ts runs in every Tauri window. Its checkpoint/cancel delegation
 * listeners were gated only on `'__TAURI_INTERNALS__' in window`, so the float
 * window registered a handler for the very event it emits — and handling it there
 * re-enters the delegation, because a non-owner's checkpoint()/cancel() emits the
 * request rather than calling the backend:
 *
 *   float receives → checkpoint() → not owner → delegateToMain() → emits → …
 *
 * One press of the "register work time" button started an unbounded loop:
 * measured 2026-10-06 over CDP, 245 emit_to/s from the float window and 297
 * GET /pomodoro/active per second from main, ~300% of one core.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Typed with the event name so `mock.calls[i][0]` is a string, not never.
const listenMock = vi.fn((_event: string, _handler?: unknown) => Promise.resolve(() => {}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
  emitTo: vi.fn(() => Promise.resolve()),
}));
vi.mock('../pomodoro-audio', () => ({
  getAudioContext: vi.fn(),
  closeAudioContext: vi.fn(),
}));

/** Load the store module fresh at a given window pathname, inside Tauri. */
async function loadStoreAt(pathname: string) {
  vi.resetModules();
  listenMock.mockClear();
  const g = globalThis as unknown as Record<string, unknown>;
  // The module's own module-level singletons are pinned to globalThis; clear them
  // so each load wires from scratch.
  delete g.__rapitasPomodoroWired;
  delete g.__rapitasPomodoroTick;
  delete g.__rapitasPomodoroChannel;
  delete g.__rapitasPomodoroStore;
  Object.defineProperty(window, 'location', {
    value: { pathname, href: `http://localhost:3000${pathname}` },
    writable: true,
    configurable: true,
  });
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  await import('../pomodoro-store');
  // The listener registration sits behind a dynamic import's .then().
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      postMessage() {}
      close() {}
    },
  );
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe('ポモドーロ委譲イベントの登録範囲', () => {
  it('main ウィンドウは委譲イベントを受け取る', async () => {
    await loadStoreAt('/');
    const events = listenMock.mock.calls.map((c) => c[0]);
    expect(events).toContain('pomodoro-float:checkpoint-request');
    expect(events).toContain('pomodoro-float:cancel-request');
  });

  // The load-bearing half: registering here is what closed the loop.
  it('float ウィンドウは自分が送出する委譲イベントを受け取らない', async () => {
    await loadStoreAt('/pomodoro-float');
    const events = listenMock.mock.calls.map((c) => c[0]);
    expect(events).not.toContain('pomodoro-float:checkpoint-request');
    expect(events).not.toContain('pomodoro-float:cancel-request');
  });

  it('他の非所有ウィンドウ(通知トースト)も受け取らない', async () => {
    await loadStoreAt('/notification-toast');
    const events = listenMock.mock.calls.map((c) => c[0]);
    expect(events).not.toContain('pomodoro-float:checkpoint-request');
  });
});
