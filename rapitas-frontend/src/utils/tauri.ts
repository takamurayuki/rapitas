/**
 * Tauri環境の検出とナビゲーションユーティリティ
 */

/**
 * 分割表示の状態を保存するインターフェース
 */
interface SplitViewData {
  originalSize: {
    type: string;
    width: number;
    height: number;
  };
  originalPosition: {
    type: string;
    x: number;
    y: number;
  };
  wasMaximized: boolean;
  wasFullscreen: boolean;
  timeout: NodeJS.Timeout | null;
  unlisten: () => void;
}

/**
 * グローバルWindowオブジェクトの拡張型定義
 */
interface ExtendedWindow extends Window {
  __RAPITAS_SPLIT_VIEW__?: SplitViewData;
  __RAPITAS_OPENING_EXTERNAL__?: boolean;
  __RAPITAS_EXTERNAL_URL_QUEUE__?: Set<string>;
  __RAPITAS_EXTERNAL_URL_TIMESTAMPS__?: Map<string, number>;
}

/**
 * Tauri環境かどうかを判定
 * window.__TAURI__ が存在するかで判定
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).__TAURI__;
}

/**
 * タスク詳細ページのパスを生成
 * Tauri環境ではクエリパラメータを使用
 * @param taskId タスクID
 * @returns パス文字列
 */
export function getTaskDetailPath(taskId: number | string): string {
  if (isTauri()) {
    // Tauri環境: 静的パスとクエリパラメータを使用
    return `/tasks/detail?id=${taskId}`;
  }
  // Web環境: 動的ルーティングを使用
  return `/tasks/${taskId}`;
}

/**
 * 承認詳細ページのパスを生成
 * @param approvalId 承認ID
 */
export function getApprovalDetailPath(approvalId: number | string): string {
  if (isTauri()) {
    return `/approvals/detail?id=${approvalId}`;
  }
  return `/approvals/${approvalId}`;
}

/**
 * GitHub PR詳細ページのパスを生成
 * @param prId PR ID
 */
export function getGitHubPRDetailPath(prId: number | string): string {
  if (isTauri()) {
    return `/github/pull-requests/detail?id=${prId}`;
  }
  return `/github/pull-requests/${prId}`;
}

/**
 * URLからクエリパラメータを取得
 * Tauri環境でのID取得に使用
 * @param param パラメータ名
 * @returns パラメータ値（存在しない場合はnull）
 */
export function getQueryParam(param: string): string | null {
  if (typeof window === "undefined") return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

/**
 * ウィンドウをシステムトレイに格納（非表示にする）
 * Tauri v2のclose()を呼び出し、Rust側のon_window_eventでprevent_close + hideで処理する
 */
export async function hideToTray(): Promise<void> {
  if (!isTauri()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tauri = (window as any).__TAURI__;
    const webviewWindow = tauri?.webviewWindow;
    if (webviewWindow) {
      const current = webviewWindow.getCurrentWebviewWindow();
      if (current) {
        // close()を呼ぶとRust側のon_window_eventでCloseRequestedイベントが発火し、
        // prevent_close() + window.hide() でトレイに格納される
        await current.close();
      }
    }
  } catch (e) {
    console.error("Failed to hide window to tray:", e);
  }
}

/**
 * 外部URLを分割表示で開く（Tauri v2）
 * ブラウザを画面左半分、Rapitasを画面右半分に配置する
 * @param url 開くURL
 * @param title ウィンドウタイトル（未使用、互換性のため残存）
 */
export async function openExternalUrlInSplitView(
  url: string,
  title: string = "External Link",
): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank");
    return;
  }

  console.log("Opening external URL in split view:", url);

  try {
    // Rustのopen_split_viewコマンドを呼び出す
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_split_view", { url });

    console.log("Split view opened successfully");

    // 分割表示状態を記録
    const splitViewData: SplitViewData = {
      originalSize: null as unknown as PhysicalSize,
      originalPosition: null as unknown as PhysicalPosition,
      wasMaximized: false,
      wasFullscreen: false,
      timeout: null,
      unlisten: () => {},
    };

    (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__ = splitViewData;

    window.dispatchEvent(
      new CustomEvent("rapitas:split-view-activated", {
        detail: { active: true },
      }),
    );
  } catch (error) {
    console.error("Failed to open URL in split view:", error);

    // フォールバック: 通常のブラウザで開く
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  }
}

/**
 * 外部URLを新しいWebViewウィンドウで開く（Tauri v2）
 * @param url 開くURL
 * @param title ウィンドウタイトル
 */
export async function openExternalUrlInNewWindow(
  url: string,
  title: string = "External Link",
): Promise<void> {
  if (!isTauri()) {
    // Web環境では通常の新しいタブで開く
    window.open(url, "_blank");
    return;
  }

  try {
    const tauri = (window as ExtendedWindow).__TAURI__;
    const webviewWindow = tauri?.webviewWindow?.WebviewWindow;

    if (webviewWindow) {
      // ウィンドウラベルを生成（URLのホスト名を使用）
      const urlObj = new URL(url);
      const label = `external-${urlObj.hostname.replace(/\./g, "-")}-${Date.now()}`;

      // 新しいWebViewウィンドウを作成
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

      // ウィンドウが作成されたらフォーカス
      newWindow.once("tauri://created", () => {
        newWindow.setFocus();
      });

      // エラーハンドリング
      newWindow.once("tauri://error", (error: unknown) => {
        console.error("Failed to create external window:", error);
        // フォールバック: システムのデフォルトブラウザで開く
        openUrlInDefaultBrowser(url);
      });
    }
  } catch (e) {
    console.error("Failed to open external URL in new window:", e);
    // フォールバック: システムのデフォルトブラウザで開く
    openUrlInDefaultBrowser(url);
  }
}

/**
 * 現在分割表示状態かどうかをチェック
 */
export function isSplitViewActive(): boolean {
  if (!isTauri()) return false;
  return !!(window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
}

/**
 * 分割表示状態を解除し、元のウィンドウ状態に復元する
 */
export async function restoreFromSplitView(): Promise<void> {
  if (!isTauri()) return;

  const splitViewData = (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
  if (!splitViewData) return;

  try {
    const windowModule = await import("@tauri-apps/api/window");
    const win = windowModule.getCurrentWindow() as ReturnType<typeof windowModule.getCurrentWindow>;

    // リスナーを解除
    if (splitViewData.unlisten) {
      splitViewData.unlisten();
    }

    // 元のサイズと位置に戻す
    if (splitViewData.originalSize && splitViewData.originalPosition) {
      await win.setSize(splitViewData.originalSize);
      await win.setPosition(splitViewData.originalPosition);
    }

    // 元の最大化/全画面状態を復元
    if (splitViewData.wasMaximized) {
      await win.maximize();
    } else if (splitViewData.wasFullscreen) {
      await win.setFullscreen(true);
    }

    // 分割表示状態をクリア
    delete (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;

    // 分割表示が解除されたことを通知
    window.dispatchEvent(
      new CustomEvent("rapitas:split-view-deactivated", {
        detail: { active: false },
      }),
    );
  } catch (e) {
    console.error("Failed to restore from split view:", e);
  }
}

/**
 * システムのデフォルトブラウザでURLを開く（Tauri v2）
 * @param url 開くURL
 */
export async function openUrlInDefaultBrowser(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank");
    return;
  }

  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch (e) {
    console.error("Failed to open URL in default browser:", e);
    // 最終フォールバック
    window.open(url, "_blank");
  }
}
