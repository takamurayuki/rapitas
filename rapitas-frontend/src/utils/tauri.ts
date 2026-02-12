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
  timeout: NodeJS.Timeout;
  unlisten: () => void;
}

/**
 * グローバルWindowオブジェクトの拡張型定義
 */
interface ExtendedWindow extends Window {
  __RAPITAS_SPLIT_VIEW__?: SplitViewData;
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
 * メインウィンドウを右半分に配置し、システムのデフォルトブラウザで外部リンクを左側に表示
 * @param url 開くURL
 * @param title ウィンドウタイトル（未使用、互換性のため残存）
 */
export async function openExternalUrlInSplitView(
  url: string,
  title: string = "External Link",
): Promise<void> {
  if (!isTauri()) {
    // Web環境では通常の新しいタブで開く
    window.open(url, "_blank");
    return;
  }

  try {
    // Tauri v2の公式APIを動的にインポート
    const windowModule = await import("@tauri-apps/api/window");
    const { open } = await import("@tauri-apps/plugin-shell");
    const { LogicalSize, LogicalPosition } =
      await import("@tauri-apps/api/dpi");

    const win = windowModule.getCurrentWindow();

    // 利用可能なモニター一覧を取得
    const monitors = await windowModule.availableMonitors();
    if (!monitors || monitors.length === 0) {
      throw new Error("モニター情報を取得できませんでした");
    }

    // プライマリモニターまたは最初のモニターを使用
    const primaryMonitor =
      monitors.find((m) => m.name === "Primary") || monitors[0];

    const { width, height } = primaryMonitor.size;
    const scaleFactor = primaryMonitor.scaleFactor || 1;

    // 論理サイズに変換
    const logicalWidth = Math.floor(width / scaleFactor);
    const logicalHeight = Math.floor(height / scaleFactor);

    // 元のウィンドウサイズと位置を保存（復元用）
    const originalSize = await win.outerSize();
    const originalPosition = await win.outerPosition();

    // 右半分に移動・リサイズ
    const halfWidth = Math.floor(logicalWidth / 2);
    await win.setSize(new LogicalSize(halfWidth, logicalHeight));
    await win.setPosition(new LogicalPosition(halfWidth, 0));

    // システムのデフォルトブラウザで外部リンクを開く
    await open(url);

    // 元のサイズに戻すためのタイマーを設定（30秒後に自動復元）
    const restoreTimeout = setTimeout(async () => {
      try {
        // 元のサイズと位置に復元
        await win.setSize(originalSize);
        await win.setPosition(originalPosition);
        console.log("Main window restored to original size after timeout");
      } catch (e) {
        console.error("Failed to restore main window after timeout:", e);
        // フォールバック: 画面中央に配置
        try {
          await win.setSize(
            new LogicalSize(
              Math.floor(logicalWidth * 0.8),
              Math.floor(logicalHeight * 0.8),
            ),
          );
          await win.center();
        } catch (fallbackError) {
          console.error(
            "Failed to fallback restore main window:",
            fallbackError,
          );
        }
      }
    }, 30000); // 30秒後に復元

    // 手動復元用のウィンドウリサイズリスナー（分割状態から復元したい場合）
    const handleResize = () => {
      clearTimeout(restoreTimeout);
    };

    // ウィンドウサイズ変更イベントをリッスン（ユーザーが手動でリサイズした場合はタイマーをクリア）
    const unlisten = await win.listen("tauri://resize", handleResize);

    // 分割表示状態を保存して、後で手動復元できるようにする
    const splitViewData: SplitViewData = {
      originalSize,
      originalPosition,
      timeout: restoreTimeout,
      unlisten,
    };

    // グローバルに保存（手動復元用）
    (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__ = splitViewData;
  } catch (e) {
    console.error("Failed to open external URL in split view:", e);
    // フォールバック: システムのデフォルトブラウザで開く
    openUrlInDefaultBrowser(url);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tauri = (window as any).__TAURI__;
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
      newWindow.once("tauri://error", (error: any) => {
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
