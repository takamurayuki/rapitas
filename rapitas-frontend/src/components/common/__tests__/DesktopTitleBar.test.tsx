import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import DesktopTitleBar from '../DesktopTitleBar';

const mocks = vi.hoisted(() => ({
  tauri: true,
  label: 'main',
  full: false,
  max: false,
  resize: undefined as undefined | (() => void),
  decorations: vi.fn(),
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@/utils/tauri', () => ({ isTauri: () => mocks.tauri }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: mocks.label,
    isMaximized: async () => mocks.max,
    isFullscreen: async () => mocks.full,
    onResized: async (callback: () => void) => {
      mocks.resize = callback;
      return mocks.stop;
    },
    setDecorations: mocks.decorations,
    minimize: mocks.minimize,
    maximize: mocks.maximize,
    unmaximize: mocks.unmaximize,
    close: mocks.close,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri = true;
  mocks.label = 'main';
  mocks.full = false;
  mocks.max = false;
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
  for (const action of [
    mocks.decorations,
    mocks.minimize,
    mocks.maximize,
    mocks.unmaximize,
    mocks.close,
  ])
    action.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('DesktopTitleBar', () => {
  it('mounts blank controls before removing the native caption', async () => {
    mocks.decorations.mockImplementation(async () => {
      expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
    });
    const { container } = render(<DesktopTitleBar />);
    await waitFor(() => expect(mocks.decorations).toHaveBeenCalledWith(false));
    expect(container.textContent).toBe('');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-tauri-drag-region]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '最小化' }));
    fireEvent.click(screen.getByRole('button', { name: '最大化' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(mocks.minimize).toHaveBeenCalledOnce();
    expect(mocks.maximize).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it.each(['web', 'mac', 'popup'])('does not change the %s window', async (kind) => {
    if (kind === 'web') mocks.tauri = false;
    if (kind === 'mac')
      Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    if (kind === 'popup') mocks.label = 'quick-capture';
    const { container } = render(<DesktopTitleBar />);
    await act(async () => {});
    expect(container.innerHTML).toBe('');
    expect(mocks.decorations).not.toHaveBeenCalled();
  });
  it('handles restore and fullscreen without showing a second titlebar', async () => {
    mocks.max = true;
    render(<DesktopTitleBar />);
    fireEvent.click(await screen.findByRole('button', { name: '元のサイズに戻す' }));
    expect(mocks.unmaximize).toHaveBeenCalledOnce();
    mocks.full = true;
    await act(async () => mocks.resize?.());
    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull();
    expect(document.documentElement.dataset.desktopFrame).toBe('fullscreen');
  });
  it('removes custom controls on permission failure and cleans up listeners', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.decorations.mockRejectedValue(new Error('denied'));
    const { unmount } = render(<DesktopTitleBar />);
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(document.documentElement.dataset.desktopFrame).toBeUndefined();
    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull();
    unmount();
    expect(mocks.stop).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
