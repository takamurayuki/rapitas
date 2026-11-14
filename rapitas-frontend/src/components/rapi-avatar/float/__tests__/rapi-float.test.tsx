/**
 * rapi-float.test
 *
 * ラピ in a window of her own on the desktop (#1535). She went behind the
 * header and behind the in-app browser, whose pages are OS surfaces no
 * z-index rises above; drawn in her own window she is above both. What has
 * to hold for that to work without anyone noticing the window:
 *
 * - clicks land on her and nowhere else (the rectangles she reports),
 * - a drag does not drop her when the pointer outruns her,
 * - she knows which task the main window has open,
 * - her links open in the main window, not in the overlay,
 * - she stays off dialogs and off the pages without the app shell.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, renderHook } from '@testing-library/react';

/** Tauri, recorded: what was invoked, emitted, and who is listening. */
const invoked: Array<{ cmd: string; args: unknown }> = [];
const emitted: Array<{ target: string; event: string; payload: unknown }> = [];
const listeners = new Map<string, Array<(e: { payload: unknown }) => void>>();

vi.mock('../tauri-bus', () => ({
  invokeQuietly: (cmd: string, args: unknown) => {
    invoked.push({ cmd, args });
  },
  sendToWindow: (target: string, event: string, payload?: unknown) => {
    emitted.push({ target, event, payload });
  },
  onTauriEvent: (event: string, handler: (payload: unknown) => void, onReady?: () => void) => {
    const wrapped = (e: { payload: unknown }) => handler(e.payload);
    listeners.set(event, [...(listeners.get(event) ?? []), wrapped]);
    onReady?.();
    return () =>
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== wrapped),
      );
  },
}));

let pathname = '/tasks';
let search = '';
const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push }),
}));
// Measured against the backend in the real window; nothing to reload here.
vi.mock('@/app/pomodoro-float/_hooks/use-stale-document-reload', () => ({
  useStaleDocumentReload: () => {},
}));

import { hitRectsOf, inAppPath } from '../rapi-float-protocol';
import { useFloatHitRects, HIT_SELECTOR } from '../useFloatHitRects';
import { RapiFloatBridge } from '../RapiFloatBridge';
import { RapiFloatPage } from '../RapiFloatPage';
import { useRapiEnvironment, useRapiLocation } from '../rapi-environment';
import { useWebviewOcclusionStore } from '@/stores/webview-occlusion-store';

/** Let the dynamic imports and the promises behind them settle. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

function fire(event: string, payload: unknown) {
  for (const h of listeners.get(event) ?? []) h({ payload });
}

function box(el: Element, r: { x: number; y: number; w: number; h: number }) {
  el.getBoundingClientRect = () =>
    ({
      left: r.x,
      top: r.y,
      width: r.w,
      height: r.h,
      right: r.x + r.w,
      bottom: r.y + r.h,
    }) as DOMRect;
}

beforeEach(() => {
  invoked.length = 0;
  emitted.length = 0;
  listeners.clear();
  push.mockReset();
  pathname = '/tasks';
  search = '';
  useWebviewOcclusionStore.setState({ occluders: [] });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('which links she hands to the main window', () => {
  it('takes in-app paths', () => {
    expect(inAppPath('/tasks/42?showHeader=true')).toBe('/tasks/42?showHeader=true');
  });

  it('leaves links that leave the app alone', () => {
    expect(inAppPath('https://example.com')).toBeNull();
    expect(inAppPath('//example.com/x')).toBeNull();
    expect(inAppPath(null)).toBeNull();
  });
});

describe('where she is drawn', () => {
  it('leaves out the panel while it is hidden', () => {
    const shown = document.createElement('div');
    const hidden = document.createElement('div');
    box(shown, { x: 10, y: 20, w: 68, h: 68 });
    box(hidden, { x: 0, y: 0, w: 0, h: 0 });
    expect(hitRectsOf([shown, hidden])).toEqual([{ x: 10, y: 20, width: 68, height: 68 }]);
  });

  it('pads each box so the edge of a shadow is still hers', () => {
    const el = document.createElement('div');
    box(el, { x: 10, y: 20, w: 68, h: 68 });
    expect(hitRectsOf([el], 4)).toEqual([{ x: 6, y: 16, width: 76, height: 76 }]);
  });
});

describe('reporting her rectangles', () => {
  function mountAvatar() {
    const button = document.createElement('button');
    button.setAttribute('data-rapi-avatar', 'true');
    box(button, { x: 1000, y: 700, w: 68, h: 68 });
    document.body.appendChild(button);
    return button;
  }

  it('reports her button, and only when something moved', () => {
    vi.useFakeTimers();
    mountAvatar();
    const send = vi.fn();
    renderHook(() => useFloatHitRects(true, send));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual([{ x: 996, y: 696, width: 76, height: 76 }]);
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('claims the whole window while she is held, so a drag cannot drop her', () => {
    const button = mountAvatar();
    const send = vi.fn();
    renderHook(() => useFloatHitRects(true, send));
    fireEvent.pointerDown(button);
    expect(send).toHaveBeenLastCalledWith([
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    ]);
    fireEvent.pointerUp(document);
    expect(send).toHaveBeenLastCalledWith([{ x: 996, y: 696, width: 76, height: 76 }]);
  });

  // Hidden by CSS she still has boxes; a dialog under her must get its clicks.
  it('reports nothing while she is hidden', () => {
    mountAvatar();
    const send = vi.fn();
    renderHook(() => useFloatHitRects(false, send));
    expect(send).toHaveBeenLastCalledWith([]);
  });

  it('counts her bubbles and the conversation list as hers', () => {
    expect(HIT_SELECTOR).toContain('[data-speech-bubble="true"]');
    expect(HIT_SELECTOR).toContain('[role="listbox"]');
  });
});

describe('the main window side', () => {
  const lastLocation = () =>
    emitted.filter((e) => e.event === 'rapi-float://location').at(-1)?.payload as
      | { pathname: string; panelParam: string | null; shown: boolean }
      | undefined;

  it('tells her where it is, and that she may be seen on an app page', async () => {
    pathname = '/tasks';
    search = 'panel=42';
    render(<RapiFloatBridge />);
    await flush();
    expect(lastLocation()).toMatchObject({ pathname: '/tasks', panelParam: '42', shown: true });
    expect(emitted.find((e) => e.event === 'rapi-float://location')?.target).toBe('rapi-float');
  });

  it('keeps her out of sight on the pages without the app shell', async () => {
    pathname = '/auth/login';
    render(<RapiFloatBridge />);
    await flush();
    expect(lastLocation()?.shown).toBe(false);
  });

  it('keeps her out of sight while a dialog is open, and brings her back after', async () => {
    render(<RapiFloatBridge />);
    await flush();
    act(() => useWebviewOcclusionStore.getState().add('dialog'));
    await flush();
    expect(lastLocation()?.shown).toBe(false);
    act(() => useWebviewOcclusionStore.getState().remove('dialog'));
    await flush();
    expect(lastLocation()?.shown).toBe(true);
  });

  // Her window is never shown or hidden for this: showing a window takes
  // the keyboard, and that would happen every time a dialog closed.
  it('never asks the desktop to show or hide her window', async () => {
    render(<RapiFloatBridge />);
    await flush();
    act(() => useWebviewOcclusionStore.getState().add('dialog'));
    await flush();
    expect(invoked).toEqual([]);
  });

  it('tells her window it has just loaded, so a stale page can reload', async () => {
    render(<RapiFloatBridge />);
    await flush();
    expect(emitted).toContainEqual({
      target: 'rapi-float',
      event: 'rapi-float://visibility-changed',
      payload: true,
    });
  });

  it('opens the link she was asked to follow', async () => {
    render(<RapiFloatBridge />);
    await flush();
    fire('rapi-float://navigate', '/tasks/7?showHeader=true');
    expect(push).toHaveBeenCalledWith('/tasks/7?showHeader=true');
  });

  it('answers her hello with where it is', async () => {
    render(<RapiFloatBridge />);
    await flush();
    emitted.length = 0;
    fire('rapi-float://hello', undefined);
    await flush();
    expect(emitted.map((e) => e.event)).toContain('rapi-float://location');
  });
});

describe('her window', () => {
  function Probe() {
    const env = useRapiEnvironment();
    const { pathname: p, panelParam } = useRapiLocation();
    return (
      <div>
        <span data-testid="where">{`${p}|${panelParam}|${env?.dark}|${env?.floating}`}</span>
        {/* A plain anchor, as her task cards render them (TaskAsk, TaskWatch). */}
        { }
        <a href="/tasks/42?showHeader=true">task</a>
      </div>
    );
  }

  it('draws nothing until the main window has said where it is', async () => {
    render(
      <RapiFloatPage>
        <Probe />
      </RapiFloatPage>,
    );
    await flush();
    expect(screen.queryByTestId('where')).toBeNull();
    expect(emitted).toContainEqual({
      target: 'main',
      event: 'rapi-float://hello',
      payload: undefined,
    });
  });

  it("sees the main window's task and theme, not its own address", async () => {
    pathname = '/rapi-float';
    render(
      <RapiFloatPage>
        <Probe />
      </RapiFloatPage>,
    );
    await flush();
    act(() =>
      fire('rapi-float://location', {
        pathname: '/tasks/9',
        panelParam: null,
        dark: true,
        shown: true,
      }),
    );
    expect(screen.getByTestId('where').textContent).toBe('/tasks/9|null|true|true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('hands an in-app link to the main window instead of following it', async () => {
    render(
      <RapiFloatPage>
        <Probe />
      </RapiFloatPage>,
    );
    await flush();
    act(() =>
      fire('rapi-float://location', { pathname: '/', panelParam: null, dark: false, shown: true }),
    );
    const link = screen.getByText('task');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    await flush();
    expect(click.defaultPrevented).toBe(true);
    expect(emitted).toContainEqual({
      target: 'main',
      event: 'rapi-float://navigate',
      payload: '/tasks/42?showHeader=true',
    });
  });

  it('hides her without unmounting her while the main window says so', async () => {
    render(
      <RapiFloatPage>
        <Probe />
      </RapiFloatPage>,
    );
    await flush();
    act(() =>
      fire('rapi-float://location', { pathname: '/', panelParam: null, dark: false, shown: false }),
    );
    const where = screen.getByTestId('where');
    expect(where.closest('[data-rapi-float-shown]')?.getAttribute('style')).toContain(
      'visibility: hidden',
    );
  });

  it('makes the page itself transparent', async () => {
    render(
      <RapiFloatPage>
        <Probe />
      </RapiFloatPage>,
    );
    await flush();
    expect(document.body.style.background).toBe('transparent');
  });
});
