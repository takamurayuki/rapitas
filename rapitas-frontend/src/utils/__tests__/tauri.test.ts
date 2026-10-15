import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  isTauri,
  getTaskDetailPath,
  getApprovalDetailPath,
  getGitHubPRDetailPath,
  getQueryParam,
  isSplitViewActive,
  hideToTray,
  openExternalUrl,
  openExternalUrlInSplitView,
  openExternalUrlInNewWindow,
  restoreFromSplitView,
  openUrlInDefaultBrowser,
  EXTERNAL_BROWSER_KEY,
} from '../tauri';

function enableTauri() {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

describe('tauri utilities', () => {
  // Store original state to restore after tests
  let originalTauri: unknown;
  let originalSplitView: unknown;

  beforeEach(() => {
    // Store original values
    originalTauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    originalSplitView = (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown })
      .__RAPITAS_SPLIT_VIEW__;

    // Clean up window state
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__;
  });

  afterEach(() => {
    // Restore original values or delete if they didn't exist
    if (originalTauri !== undefined) {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = originalTauri;
    } else {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }

    if (originalSplitView !== undefined) {
      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ =
        originalSplitView;
    } else {
      delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__;
    }
  });

  describe('isTauri', () => {
    it('Tauri環境でないときfalseを返す', () => {
      expect(isTauri()).toBe(false);
    });

    it('Tauri環境のときtrueを返す', () => {
      // Mock Tauri API
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
        event: {},
        window: {},
      };

      expect(isTauri()).toBe(true);
    });
  });

  describe('getTaskDetailPath', () => {
    it('Web環境で数値IDの場合、動的ルートのパスを返す', () => {
      expect(getTaskDetailPath(123)).toBe('/tasks/123');
    });

    it('Web環境で文字列IDの場合、動的ルートのパスを返す', () => {
      expect(getTaskDetailPath('abc')).toBe('/tasks/abc');
    });

    it('Tauri環境で数値IDの場合、クエリパラメータ形式のパスを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

      expect(getTaskDetailPath(456)).toBe('/tasks/detail?id=456');
    });

    it('Tauri環境で文字列IDの場合、クエリパラメータ形式のパスを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

      expect(getTaskDetailPath('xyz')).toBe('/tasks/detail?id=xyz');
    });
  });

  describe('getApprovalDetailPath', () => {
    it('Web環境で正しいパスを返す', () => {
      expect(getApprovalDetailPath(789)).toBe('/approvals/789');
    });

    it('Tauri環境で正しいパスを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

      expect(getApprovalDetailPath(789)).toBe('/approvals/detail?id=789');
    });

    it('文字列IDを正しく処理する', () => {
      expect(getApprovalDetailPath('approval-abc')).toBe('/approvals/approval-abc');
    });
  });

  describe('getGitHubPRDetailPath', () => {
    it('Web環境で正しいパスを返す', () => {
      expect(getGitHubPRDetailPath(42)).toBe('/github/pull-requests/42');
    });

    it('Tauri環境で正しいパスを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

      expect(getGitHubPRDetailPath(42)).toBe('/github/pull-requests/detail?id=42');
    });

    it('文字列IDを正しく処理する', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

      expect(getGitHubPRDetailPath('pr-123')).toBe('/github/pull-requests/detail?id=pr-123');
    });
  });

  describe('getQueryParam', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // Mock window.location
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it('URLに存在するパラメータを取得する', () => {
      Object.defineProperty(window, 'location', {
        value: {
          search: '?id=123&name=test&status=active',
        },
        writable: true,
      });

      expect(getQueryParam('id')).toBe('123');
      expect(getQueryParam('name')).toBe('test');
      expect(getQueryParam('status')).toBe('active');
    });

    it('URLに存在しないパラメータはnullを返す', () => {
      Object.defineProperty(window, 'location', {
        value: {
          search: '?id=123&name=test',
        },
        writable: true,
      });

      expect(getQueryParam('missing')).toBe(null);
      expect(getQueryParam('nonexistent')).toBe(null);
    });

    it('クエリパラメータがない場合はnullを返す', () => {
      Object.defineProperty(window, 'location', {
        value: {
          search: '',
        },
        writable: true,
      });

      expect(getQueryParam('id')).toBe(null);
    });

    it('同名パラメータが複数ある場合、最初の値を返す', () => {
      Object.defineProperty(window, 'location', {
        value: {
          search: '?id=first&id=second',
        },
        writable: true,
      });

      expect(getQueryParam('id')).toBe('first');
    });
  });

  describe('isSplitViewActive', () => {
    it('Tauri環境でない場合、falseを返す', () => {
      expect(isSplitViewActive()).toBe(false);
    });

    it('Tauri環境でスプリットビュー状態がない場合、falseを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

      expect(isSplitViewActive()).toBe(false);
    });

    it('Tauri環境でスプリットビュー状態がある場合、trueを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ = {
        originalSize: { width: 1200, height: 800 },
        originalPosition: { x: 100, y: 100 },
        wasMaximized: false,
        wasFullscreen: false,
        timeout: null,
        unlisten: () => {},
      };

      expect(isSplitViewActive()).toBe(true);
    });

    it('スプリットビュー状態がnullの場合、falseを返す', () => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ = null;

      expect(isSplitViewActive()).toBe(false);
    });
  });

  describe('hideToTray', () => {
    afterEach(() => {
      vi.doUnmock('@tauri-apps/api/webviewWindow');
    });

    it('Tauri環境でなければ何もしないこと', async () => {
      await expect(hideToTray()).resolves.toBeUndefined();
    });

    it('Tauri環境ではcurrent windowをclose()すること', async () => {
      enableTauri();
      const mockClose = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/webviewWindow', () => ({
        getCurrentWebviewWindow: () => ({ close: mockClose }),
      }));

      await hideToTray();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('close()が失敗しても例外を投げないこと', async () => {
      enableTauri();
      vi.doMock('@tauri-apps/api/webviewWindow', () => ({
        getCurrentWebviewWindow: () => ({ close: () => Promise.reject(new Error('fail')) }),
      }));

      await expect(hideToTray()).resolves.toBeUndefined();
    });
  });

  describe('openExternalUrl', () => {
    let openSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      localStorage.removeItem(EXTERNAL_BROWSER_KEY);
    });

    afterEach(() => {
      openSpy.mockRestore();
      vi.doUnmock('@tauri-apps/api/core');
      localStorage.removeItem(EXTERNAL_BROWSER_KEY);
    });

    it('Tauri環境でなければ新しいタブで開くこと', async () => {
      await openExternalUrl('https://example.com');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    });

    it('Tauri環境かつブラウザ未指定の場合はデフォルトブラウザで開くこと', async () => {
      enableTauri();
      const mockInvoke = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

      await openExternalUrl('https://example.com');

      expect(mockInvoke).toHaveBeenCalledWith('plugin:shell|open', { path: 'https://example.com' });
    });

    it('Tauri環境かつブラウザ指定時は指定ブラウザで開くこと', async () => {
      enableTauri();
      localStorage.setItem(EXTERNAL_BROWSER_KEY, 'chrome');
      const mockInvoke = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

      await openExternalUrl('https://example.com');

      expect(mockInvoke).toHaveBeenCalledWith('open_url_in_browser', {
        url: 'https://example.com',
        browser: 'chrome',
      });
    });

    it('invokeが失敗した場合はブラウザへフォールバックすること', async () => {
      enableTauri();
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: () => Promise.reject(new Error('fail')),
      }));

      await openExternalUrl('https://example.com');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    });
  });

  describe('openExternalUrlInSplitView', () => {
    let openSpy: ReturnType<typeof vi.spyOn>;
    let dispatchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      localStorage.removeItem(EXTERNAL_BROWSER_KEY);
      delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__;
    });

    afterEach(() => {
      openSpy.mockRestore();
      dispatchSpy.mockRestore();
      vi.doUnmock('@tauri-apps/api/core');
      vi.doUnmock('@tauri-apps/plugin-shell');
      delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__;
    });

    it('Tauri環境でなければ新しいタブで開くこと', async () => {
      await openExternalUrlInSplitView('https://example.com');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
    });

    it('成功時はスプリットビュー状態を記録しイベントを発火すること', async () => {
      enableTauri();
      const mockInvoke = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

      await openExternalUrlInSplitView('https://example.com');

      expect(mockInvoke).toHaveBeenCalledWith('open_split_view', { url: 'https://example.com' });
      expect(
        (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__,
      ).toBeTruthy();
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'rapitas:split-view-activated' }),
      );
    });

    it('ブラウザ指定時はブラウザ名込みでinvokeすること', async () => {
      enableTauri();
      localStorage.setItem(EXTERNAL_BROWSER_KEY, 'firefox');
      const mockInvoke = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

      await openExternalUrlInSplitView('https://example.com');

      expect(mockInvoke).toHaveBeenCalledWith('open_split_view', {
        url: 'https://example.com',
        browser: 'firefox',
      });
    });

    it('invoke失敗時はplugin-shellのopenへフォールバックすること', async () => {
      enableTauri();
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: () => Promise.reject(new Error('fail')),
      }));
      const mockShellOpen = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/plugin-shell', () => ({ open: mockShellOpen }));

      await openExternalUrlInSplitView('https://example.com');

      expect(mockShellOpen).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('openExternalUrlInNewWindow', () => {
    let openSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    afterEach(() => {
      openSpy.mockRestore();
      vi.doUnmock('@tauri-apps/api/webviewWindow');
      vi.doUnmock('@tauri-apps/api/core');
      vi.doUnmock('@tauri-apps/plugin-shell');
    });

    it('Tauri環境でなければ新しいタブで開くこと', async () => {
      await openExternalUrlInNewWindow('https://example.com', 'Title');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
    });

    it('成功時は新しいWebviewWindowを生成しフォーカスすること', async () => {
      enableTauri();
      const mockSetFocus = vi.fn();
      const onceHandlers: Record<string, (error?: unknown) => void> = {};
      class MockWebviewWindow {
        constructor(
          public label: string,
          public options: Record<string, unknown>,
        ) {}
        once(event: string, cb: (error?: unknown) => void) {
          onceHandlers[event] = cb;
        }
        setFocus = mockSetFocus;
      }
      vi.doMock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: MockWebviewWindow }));

      await openExternalUrlInNewWindow('https://example.com', 'My Title');

      onceHandlers['tauri://created']?.();
      expect(mockSetFocus).toHaveBeenCalledTimes(1);
    });

    it('ウィンドウ作成中にtauri://errorが発生した場合はデフォルトブラウザにフォールバックすること', async () => {
      enableTauri();
      const onceHandlers: Record<string, (error?: unknown) => void> = {};
      class MockWebviewWindow {
        constructor(
          public label: string,
          public options: Record<string, unknown>,
        ) {}
        once(event: string, cb: (error?: unknown) => void) {
          onceHandlers[event] = cb;
        }
        setFocus = vi.fn();
      }
      vi.doMock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: MockWebviewWindow }));
      vi.doMock('@tauri-apps/plugin-shell', () => ({ open: vi.fn().mockResolvedValue(undefined) }));

      await openExternalUrlInNewWindow('https://example.com');

      // Trigger the registered error handler; it falls back via openUrlInDefaultBrowser,
      // which (in a Tauri env) calls the plugin-shell `open` — observed indirectly
      // through window.open NOT being called (since the shell path succeeds).
      await onceHandlers['tauri://error']?.(new Error('window creation failed'));

      expect(openSpy).not.toHaveBeenCalled();
    });

    it('WebviewWindowの生成自体が例外を投げた場合もフォールバックすること', async () => {
      enableTauri();
      vi.doMock('@tauri-apps/api/webviewWindow', () => ({
        WebviewWindow: class {
          constructor() {
            throw new Error('cannot construct');
          }
        },
      }));
      vi.doMock('@tauri-apps/plugin-shell', () => ({
        open: () => Promise.reject(new Error('shell also failed')),
      }));

      await openExternalUrlInNewWindow('https://example.com');
      // openUrlInDefaultBrowser is fire-and-forget from the outer catch block,
      // so its own nested dynamic-import + reject + fallback chain needs a
      // few extra ticks to settle before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Both the WebviewWindow construction AND the plugin-shell fallback failed,
      // so the final fallback (window.open) must have been used.
      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
    });
  });

  describe('restoreFromSplitView', () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__;
    });

    afterEach(() => {
      dispatchSpy.mockRestore();
      vi.doUnmock('@tauri-apps/api/window');
      vi.doUnmock('@tauri-apps/api/dpi');
      delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__;
    });

    it('Tauri環境でなければ何もしないこと', async () => {
      await expect(restoreFromSplitView()).resolves.toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('スプリットビュー状態が無ければ何もしないこと', async () => {
      enableTauri();
      await expect(restoreFromSplitView()).resolves.toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('状態がある場合はサイズ・位置を復元しイベントを発火すること', async () => {
      enableTauri();
      const mockSetSize = vi.fn().mockResolvedValue(undefined);
      const mockSetPosition = vi.fn().mockResolvedValue(undefined);
      const mockMaximize = vi.fn().mockResolvedValue(undefined);
      const mockSetFullscreen = vi.fn().mockResolvedValue(undefined);
      const mockUnlisten = vi.fn();

      vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: () => ({
          setSize: mockSetSize,
          setPosition: mockSetPosition,
          maximize: mockMaximize,
          setFullscreen: mockSetFullscreen,
        }),
      }));
      vi.doMock('@tauri-apps/api/dpi', () => ({
        LogicalSize: class {
          constructor(
            public width: number,
            public height: number,
          ) {}
        },
        LogicalPosition: class {
          constructor(
            public x: number,
            public y: number,
          ) {}
        },
      }));

      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ = {
        originalSize: { width: 1200, height: 800 },
        originalPosition: { x: 10, y: 20 },
        wasMaximized: false,
        wasFullscreen: false,
        timeout: null,
        unlisten: mockUnlisten,
      };

      await restoreFromSplitView();

      expect(mockUnlisten).toHaveBeenCalledTimes(1);
      expect(mockSetSize).toHaveBeenCalledTimes(1);
      expect(mockSetPosition).toHaveBeenCalledTimes(1);
      expect(
        (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__,
      ).toBeUndefined();
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'rapitas:split-view-deactivated' }),
      );
    });

    it('wasMaximizedがtrueの場合はmaximize()を呼ぶこと', async () => {
      enableTauri();
      const mockMaximize = vi.fn().mockResolvedValue(undefined);
      const mockSetFullscreen = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: () => ({
          setSize: vi.fn().mockResolvedValue(undefined),
          setPosition: vi.fn().mockResolvedValue(undefined),
          maximize: mockMaximize,
          setFullscreen: mockSetFullscreen,
        }),
      }));
      vi.doMock('@tauri-apps/api/dpi', () => ({
        LogicalSize: class {},
        LogicalPosition: class {},
      }));

      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ = {
        originalSize: { width: 100, height: 100 },
        originalPosition: { x: 0, y: 0 },
        wasMaximized: true,
        wasFullscreen: false,
        timeout: null,
        unlisten: () => {},
      };

      await restoreFromSplitView();

      expect(mockMaximize).toHaveBeenCalledTimes(1);
      expect(mockSetFullscreen).not.toHaveBeenCalled();
    });

    it('wasFullscreenがtrueの場合はsetFullscreen(true)を呼ぶこと', async () => {
      enableTauri();
      const mockSetFullscreen = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: () => ({
          setSize: vi.fn().mockResolvedValue(undefined),
          setPosition: vi.fn().mockResolvedValue(undefined),
          maximize: vi.fn(),
          setFullscreen: mockSetFullscreen,
        }),
      }));
      vi.doMock('@tauri-apps/api/dpi', () => ({
        LogicalSize: class {},
        LogicalPosition: class {},
      }));

      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ = {
        originalSize: { width: 100, height: 100 },
        originalPosition: { x: 0, y: 0 },
        wasMaximized: false,
        wasFullscreen: true,
        timeout: null,
        unlisten: () => {},
      };

      await restoreFromSplitView();

      expect(mockSetFullscreen).toHaveBeenCalledWith(true);
    });

    it('復元処理中に例外が発生しても伝播しないこと', async () => {
      enableTauri();
      vi.doMock('@tauri-apps/api/window', () => ({
        getCurrentWindow: () => {
          throw new Error('boom');
        },
      }));
      vi.doMock('@tauri-apps/api/dpi', () => ({
        LogicalSize: class {},
        LogicalPosition: class {},
      }));

      (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }).__RAPITAS_SPLIT_VIEW__ = {
        originalSize: { width: 100, height: 100 },
        originalPosition: { x: 0, y: 0 },
        wasMaximized: false,
        wasFullscreen: false,
        timeout: null,
        unlisten: () => {},
      };

      await expect(restoreFromSplitView()).resolves.toBeUndefined();
    });
  });

  describe('openUrlInDefaultBrowser', () => {
    let openSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    afterEach(() => {
      openSpy.mockRestore();
      vi.doUnmock('@tauri-apps/plugin-shell');
    });

    it('Tauri環境でなければ新しいタブで開くこと', async () => {
      await openUrlInDefaultBrowser('https://example.com');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
    });

    it('Tauri環境ではplugin-shellのopenを呼ぶこと', async () => {
      enableTauri();
      const mockShellOpen = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@tauri-apps/plugin-shell', () => ({ open: mockShellOpen }));

      await openUrlInDefaultBrowser('https://example.com');

      expect(mockShellOpen).toHaveBeenCalledWith('https://example.com');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('plugin-shellのopenが失敗した場合はwindow.openへフォールバックすること', async () => {
      enableTauri();
      vi.doMock('@tauri-apps/plugin-shell', () => ({
        open: () => Promise.reject(new Error('fail')),
      }));

      await openUrlInDefaultBrowser('https://example.com');

      expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
    });
  });
});
