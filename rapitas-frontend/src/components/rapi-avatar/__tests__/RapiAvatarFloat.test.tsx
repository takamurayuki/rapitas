/**
 * RapiAvatarFloat.test
 *
 * On the desktop ラピ is drawn in a window of her own laid over the main one,
 * so she can be above the header and the in-app browser (#1535). The main
 * window must then not draw a second her, and in her own window a click on
 * the app — which lands in another window — must still dismiss her panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent, screen } from '@testing-library/react';

let pathname = '/dashboard';
const emitted: Array<{ target: string; event: string }> = [];
let resumableCalls = 0;

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('@/hooks/useDarkMode', () => ({ useDarkMode: () => ({ isDarkMode: false }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../state/useRapiAvatarState', () => ({
  useRapiAvatarState: () => ({ state: 'idle', agents: 0 }),
}));
vi.mock('@/components/resumable-executions/useResumableExecutions', () => ({
  useResumableExecutions: () => {
    resumableCalls += 1;
    return {
      executions: [],
      runningCount: 0,
      interruptedCount: 0,
      resumingIds: new Set<number>(),
      dismissingIds: new Set<number>(),
      handleResume: vi.fn(),
      handleResumeAll: vi.fn(),
      handleDismiss: vi.fn(),
      formatTimeAgo: () => '',
    };
  },
}));
vi.mock('../float/tauri-bus', () => ({
  invokeQuietly: () => {},
  sendToWindow: (target: string, event: string) => {
    emitted.push({ target, event });
  },
  onTauriEvent: () => () => {},
}));

import RapiAvatarHost, { RapiAvatarResident } from '../RapiAvatarHost';
import { RapiEnvironmentProvider } from '../float/rapi-environment';

const avatarButton = () => document.querySelector('[data-rapi-avatar="true"]') as HTMLElement;

beforeEach(() => {
  pathname = '/dashboard';
  emitted.length = 0;
  resumableCalls = 0;
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe('the main window on the desktop', () => {
  it('draws no avatar of its own, and tells her window where it is', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    render(<RapiAvatarHost />);
    expect(avatarButton()).toBeNull();
    expect(resumableCalls).toBe(0);
    expect(emitted).toContainEqual({ target: 'rapi-float', event: 'rapi-float://location' });
  });

  it('still draws her in the browser', () => {
    render(<RapiAvatarHost />);
    expect(avatarButton()).toBeTruthy();
    expect(emitted).toEqual([]);
  });
});

describe('her panel in her own window', () => {
  function renderIn(floating: boolean) {
    render(
      <RapiEnvironmentProvider
        value={{ pathname: '/dashboard', panelParam: null, dark: false, floating }}
      >
        <RapiAvatarResident />
      </RapiEnvironmentProvider>,
    );
    fireEvent.click(avatarButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
  }

  // A press on the app lands in the main window, never in her document; her
  // window losing focus is the only sign of it.
  it('closes when her window loses focus', () => {
    renderIn(true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // In the browser a blur is switching apps, which never closed it before.
  it('stays open on a blur in the main document', () => {
    renderIn(false);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
