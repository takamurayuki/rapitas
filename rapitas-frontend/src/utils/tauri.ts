/**
 * Tauri environment detection and navigation utilities
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('Tauri');

// Tauri type definitions (simplified to match actual API)
interface TauriSize {
  width: number;
  height: number;
}

interface TauriPosition {
  x: number;
  y: number;
}

interface TauriWindow {
  setSize(size: TauriSize): Promise<void>;
  setPosition(position: TauriPosition): Promise<void>;
  maximize(): Promise<void>;
  setFullscreen(fullscreen: boolean): Promise<void>;
}

interface WebviewWindowConstructor {
  new (label: string, options?: WebviewWindowOptions): WebviewWindow;
}

interface WebviewWindow {
  once(event: string, callback: (error?: unknown) => void): void;
  setFocus(): void;
}

interface WebviewWindowOptions {
  url: string;
  title: string;
  width: number;
  height: number;
  resizable: boolean;
  center: boolean;
  minimizable: boolean;
  maximizable: boolean;
  closable: boolean;
  decorations: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
}

interface TauriAPI {
  event: {
    listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
    emit: (event: string, payload?: unknown) => Promise<void>;
  };
  window: {
    getCurrent: () => TauriWindow;
  };
  core?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  webviewWindow?: {
    WebviewWindow: WebviewWindowConstructor;
    getCurrent(): TauriWindow;
    getCurrentWebviewWindow(): {
      close(): Promise<void>;
    };
  };
}

/**
 * Interface for saving split view state
 */
interface SplitViewData {
  originalSize: TauriSize;
  originalPosition: TauriPosition;
  wasMaximized: boolean;
  wasFullscreen: boolean;
  timeout: NodeJS.Timeout | null;
  unlisten: () => void;
}

/**
 * Extended type definition for global Window object
 */
type ExtendedWindow = Window & {
  __TAURI__?: TauriAPI;
  __RAPITAS_SPLIT_VIEW__?: SplitViewData;
  __RAPITAS_OPENING_EXTERNAL__?: boolean;
  __RAPITAS_EXTERNAL_URL_QUEUE__?: Set<string>;
  __RAPITAS_EXTERNAL_URL_TIMESTAMPS__?: Map<string, number>;
};

/**
 * Determine if running in Tauri environment
 * Checks for window.__TAURI__ existence
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as ExtendedWindow).__TAURI__;
}

/**
 * Generate path for task detail page
 * Uses query parameters in Tauri environment
 * @param taskId Task ID
 * @returns Path string
 */
export function getTaskDetailPath(taskId: number | string): string {
  if (isTauri()) {
    // Tauri: use static path with query parameters
    return `/tasks/detail?id=${taskId}`;
  }
  // Web: use dynamic routing
  return `/tasks/${taskId}`;
}

/**
 * Generate path for approval detail page
 * @param approvalId Approval ID
 */
export function getApprovalDetailPath(approvalId: number | string): string {
  if (isTauri()) {
    return `/approvals/detail?id=${approvalId}`;
  }
  return `/approvals/${approvalId}`;
}

/**
 * Generate path for GitHub PR detail page
 * @param prId PR ID
 */
export function getGitHubPRDetailPath(prId: number | string): string {
  if (isTauri()) {
    return `/github/pull-requests/detail?id=${prId}`;
  }
  return `/github/pull-requests/${prId}`;
}

/**
 * Get query parameter from URL
 * Used for ID retrieval in Tauri environment
 * @param param Parameter name
 * @returns Parameter value (null if not found)
 */
export function getQueryParam(param: string): string | null {
  if (typeof window === 'undefined') return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

/**
 * Minimize window to system tray (hide)
 * Calls Tauri v2 close(), which triggers prevent_close + hide in Rust on_window_event
 */
export async function hideToTray(): Promise<void> {
  if (!isTauri()) return;
  try {
    const tauri = (window as ExtendedWindow).__TAURI__;
    const webviewWindow = tauri?.webviewWindow;
    if (webviewWindow) {
      const current = webviewWindow.getCurrentWebviewWindow();
      if (current) {
        // NOTE: close() fires CloseRequested event in Rust's on_window_event,
        // where prevent_close() + window.hide() minimizes to tray
        await current.close();
      }
    }
  } catch (e) {
    logger.error('Failed to hide window to tray:', e);
  }
}

/**
 * Open external URL in split view (Tauri v2)
 * Places browser on left half and Rapitas on right half of screen
 * @param url URL to open
 * @param title Window title (unused, kept for compatibility)
 */
export async function openExternalUrlInSplitView(
  url: string,
  title: string = 'External Link',
): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }

  logger.debug('Opening external URL in split view:', url);

  try {
    // Call Rust open_split_view command
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_split_view', { url });

    logger.debug('Split view opened successfully');

    // Record split view state
    const splitViewData: SplitViewData = {
      originalSize: { width: 0, height: 0 },
      originalPosition: { x: 0, y: 0 },
      wasMaximized: false,
      wasFullscreen: false,
      timeout: null,
      unlisten: () => {},
    };

    (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__ = splitViewData;

    window.dispatchEvent(
      new CustomEvent('rapitas:split-view-activated', {
        detail: { active: true },
      }),
    );
  } catch (error) {
    logger.error('Failed to open URL in split view:', error);

    // Fallback: open in default browser
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  }
}

/**
 * Open external URL in a new WebView window (Tauri v2)
 * @param url URL to open
 * @param title Window title
 */
export async function openExternalUrlInNewWindow(
  url: string,
  title: string = 'External Link',
): Promise<void> {
  if (!isTauri()) {
    // Open in new tab for web environment
    window.open(url, '_blank');
    return;
  }

  try {
    const tauri = (window as ExtendedWindow).__TAURI__;
    const webviewWindow = tauri?.webviewWindow?.WebviewWindow;

    if (webviewWindow) {
      // Generate window label (using URL hostname)
      const urlObj = new URL(url);
      const label = `external-${urlObj.hostname.replace(/\./g, '-')}-${Date.now()}`;

      // Create new WebView window
      const newWindow = new webviewWindow(label, {
        url,
        title,
        width: 1200,
        height: 800,
        resizable: true,
        center: true,
        minimizable: true,
        maximizable: true,
        closable: true,
        decorations: true,
        alwaysOnTop: false,
        skipTaskbar: false,
      });

      // Focus window after creation
      newWindow.once('tauri://created', () => {
        newWindow.setFocus();
      });

      // Error handling
      newWindow.once('tauri://error', (error: unknown) => {
        logger.error('Failed to create external window:', error);
        // Fallback: open in system default browser
        openUrlInDefaultBrowser(url);
      });
    }
  } catch (e) {
    logger.error('Failed to open external URL in new window:', e);
    // Fallback: open in system default browser
    openUrlInDefaultBrowser(url);
  }
}

/**
 * Check if currently in split view state
 */
export function isSplitViewActive(): boolean {
  if (!isTauri()) return false;
  return !!(window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
}

/**
 * Exit split view and restore original window state
 */
export async function restoreFromSplitView(): Promise<void> {
  if (!isTauri()) return;

  const splitViewData = (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
  if (!splitViewData) return;

  try {
    const windowModule = await import('@tauri-apps/api/window');
    const { LogicalSize, LogicalPosition } = await import('@tauri-apps/api/dpi');
    const win = windowModule.getCurrentWindow() as ReturnType<typeof windowModule.getCurrentWindow>;

    // Remove listeners
    if (splitViewData.unlisten) {
      splitViewData.unlisten();
    }

    // Restore original size and position
    if (splitViewData.originalSize && splitViewData.originalPosition) {
      await win.setSize(
        new LogicalSize(splitViewData.originalSize.width, splitViewData.originalSize.height),
      );
      await win.setPosition(
        new LogicalPosition(splitViewData.originalPosition.x, splitViewData.originalPosition.y),
      );
    }

    // Restore original maximized/fullscreen state
    if (splitViewData.wasMaximized) {
      await win.maximize();
    } else if (splitViewData.wasFullscreen) {
      await win.setFullscreen(true);
    }

    // Clear split view state
    delete (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;

    // Notify that split view has been exited
    window.dispatchEvent(
      new CustomEvent('rapitas:split-view-deactivated', {
        detail: { active: false },
      }),
    );
  } catch (e) {
    logger.error('Failed to restore from split view:', e);
  }
}

/**
 * Open URL in system default browser (Tauri v2)
 * @param url URL to open
 */
export async function openUrlInDefaultBrowser(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }

  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch (e) {
    logger.error('Failed to open URL in default browser:', e);
    // Final fallback
    window.open(url, '_blank');
  }
}
