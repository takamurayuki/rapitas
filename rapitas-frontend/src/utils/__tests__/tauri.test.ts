import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  isTauri,
  getTaskDetailPath,
  getApprovalDetailPath,
  getGitHubPRDetailPath,
  getQueryParam,
  isSplitViewActive,
} from '../tauri';

describe('tauri utilities', () => {
  // Store original state to restore after tests
  let originalTauri: unknown;
  let originalSplitView: unknown;

  beforeEach(() => {
    // Store original values
    originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    originalSplitView = (
      window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }
    ).__RAPITAS_SPLIT_VIEW__;

    // Clean up window state
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown })
      .__RAPITAS_SPLIT_VIEW__;
  });

  afterEach(() => {
    // Restore original values or delete if they didn't exist
    if (originalTauri !== undefined) {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
    } else {
      delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    }

    if (originalSplitView !== undefined) {
      (
        window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }
      ).__RAPITAS_SPLIT_VIEW__ = originalSplitView;
    } else {
      delete (window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown })
        .__RAPITAS_SPLIT_VIEW__;
    }
  });

  describe('isTauri', () => {
    it('Tauri環境でないときfalseを返す', () => {
      expect(isTauri()).toBe(false);
    });

    it('Tauri環境のときtrueを返す', () => {
      // Mock Tauri API
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
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
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

      expect(getTaskDetailPath(456)).toBe('/tasks/detail?id=456');
    });

    it('Tauri環境で文字列IDの場合、クエリパラメータ形式のパスを返す', () => {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

      expect(getTaskDetailPath('xyz')).toBe('/tasks/detail?id=xyz');
    });
  });

  describe('getApprovalDetailPath', () => {
    it('Web環境で正しいパスを返す', () => {
      expect(getApprovalDetailPath(789)).toBe('/approvals/789');
    });

    it('Tauri環境で正しいパスを返す', () => {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

      expect(getApprovalDetailPath(789)).toBe('/approvals/detail?id=789');
    });

    it('文字列IDを正しく処理する', () => {
      expect(getApprovalDetailPath('approval-abc')).toBe(
        '/approvals/approval-abc',
      );
    });
  });

  describe('getGitHubPRDetailPath', () => {
    it('Web環境で正しいパスを返す', () => {
      expect(getGitHubPRDetailPath(42)).toBe('/github/pull-requests/42');
    });

    it('Tauri環境で正しいパスを返す', () => {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

      expect(getGitHubPRDetailPath(42)).toBe(
        '/github/pull-requests/detail?id=42',
      );
    });

    it('文字列IDを正しく処理する', () => {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

      expect(getGitHubPRDetailPath('pr-123')).toBe(
        '/github/pull-requests/detail?id=pr-123',
      );
    });
  });

  describe('getQueryParam', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // Mock window.location
      delete (window as { location?: Location }).location;
      window.location = { ...originalLocation };
    });

    afterEach(() => {
      window.location = originalLocation;
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
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

      expect(isSplitViewActive()).toBe(false);
    });

    it('Tauri環境でスプリットビュー状態がある場合、trueを返す', () => {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
      (
        window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }
      ).__RAPITAS_SPLIT_VIEW__ = {
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
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
      (
        window as unknown as { __RAPITAS_SPLIT_VIEW__?: unknown }
      ).__RAPITAS_SPLIT_VIEW__ = null;

      expect(isSplitViewActive()).toBe(false);
    });
  });
});
