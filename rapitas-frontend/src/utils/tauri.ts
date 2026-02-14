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
 * メインウィンドウを左半分に配置し、システムのデフォルトブラウザで外部リンクを右側に表示
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

  // 処理中URLのタイムスタンプを管理するマップを初期化
  if (!(window as any).__RAPITAS_EXTERNAL_URL_TIMESTAMPS__) {
    (window as any).__RAPITAS_EXTERNAL_URL_TIMESTAMPS__ = new Map<
      string,
      number
    >();
  }

  const urlTimestamps = (window as any)
    .__RAPITAS_EXTERNAL_URL_TIMESTAMPS__ as Map<string, number>;
  const now = Date.now();

  // 同じURLが100ms以内に処理された場合はスキップ（ダブルクリック防止）
  const lastTimestamp = urlTimestamps.get(url);
  if (lastTimestamp && now - lastTimestamp < 100) {
    console.log("URL was recently processed, skipping...", url);
    return;
  }

  // タイムスタンプを記録
  urlTimestamps.set(url, now);

  try {
    // Tauri v2の公式APIを動的にインポート
    const windowModule = await import("@tauri-apps/api/window");
    const { open } = await import("@tauri-apps/plugin-shell");
    const { LogicalSize, LogicalPosition } =
      await import("@tauri-apps/api/dpi");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = windowModule.getCurrentWindow() as any;

    // 既に分割表示中の場合は、新しいURLをブラウザで開くのみ
    if (isSplitViewActive()) {
      await open(url);
      return;
    }

    // 現在のモニター情報を取得
    // win.currentMonitor は環境によって未実装/関数でないケースがあるため使用しない
    const primaryMonitor =
      (typeof windowModule.primaryMonitor === "function"
        ? await windowModule.primaryMonitor()
        : undefined) ||
      // 最後の手段として availableMonitors の先頭を使用
      (
        (typeof windowModule.availableMonitors === "function"
          ? await windowModule.availableMonitors()
          : []) as any[]
      )?.[0];

    if (!primaryMonitor) {
      throw new Error("モニター情報を取得できませんでした");
    }

    // ウィンドウが最大化または全画面表示の場合は解除する
    const isMaximized = await win.isMaximized();
    const isFullscreen = await win.isFullscreen();

    console.log("Window state before split view:", { isMaximized, isFullscreen });

    // 画面サイズ計算（共通で使用）
    const { width: screenWidth, height: screenHeight } = primaryMonitor.size;
    const scaleFactor = primaryMonitor.scaleFactor || 1;
    const screenPos = primaryMonitor.position || { x: 0, y: 0 };

    const logicalScreenWidth = Math.floor(screenWidth / scaleFactor);
    const logicalScreenHeight = Math.floor(screenHeight / scaleFactor);
    const logicalMonitorX = Math.floor(screenPos.x / scaleFactor);
    const logicalMonitorY = Math.floor(screenPos.y / scaleFactor);

    // 分割表示のサイズ計算
    const halfWidth = Math.round(logicalScreenWidth / 2);
    const rightPositionX = logicalMonitorX + halfWidth;
    const headerHeightOffset = 30;
    const splitViewRightOffsetPx = 10;

    // 最大化/全画面の場合は、まず右半分の位置に小さく配置する
    // これにより、ブラウザが全画面で開くのを防ぐ
    if (isMaximized || isFullscreen) {
      // 先に、デスクトップに小さなウィンドウとして配置
      // これにより、ブラウザがデスクトップのサイズを正しく認識できる
      const tempWidth = Math.floor(halfWidth * 0.8);
      const tempHeight = Math.floor((logicalScreenHeight - headerHeightOffset) * 0.8);
      const tempX = logicalMonitorX + Math.floor((logicalScreenWidth - tempWidth) / 2);
      const tempY = logicalMonitorY + Math.floor((logicalScreenHeight - tempHeight) / 2);

      if (isFullscreen) {
        console.log("Exiting fullscreen...");
        await win.setFullscreen(false);
        // 全画面解除を確実に待つ
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (isMaximized) {
        console.log("Unmaximizing window...");
        await win.unmaximize();
        // 最大化解除を確実に待つ
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // 一時的に中央に小さく配置
      await win.setSize(new LogicalSize(tempWidth, tempHeight));
      await win.setPosition(new LogicalPosition(tempX, tempY));

      // ウィンドウマネージャーが状態を更新するのを待つ
      await new Promise((resolve) => setTimeout(resolve, 300));

      // その後、右半分のサイズと位置に設定
      await win.setSize(
        new LogicalSize(halfWidth, logicalScreenHeight - headerHeightOffset),
      );
      await win.setPosition(
        new LogicalPosition(
          rightPositionX - splitViewRightOffsetPx,
          logicalMonitorY,
        ),
      );

      // 最終的な位置設定が完了するまで待つ
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // 元のウィンドウサイズと位置を保存（復元用）
    const originalSize = isMaximized || isFullscreen
      ? new LogicalSize(logicalScreenWidth * 0.8, logicalScreenHeight * 0.8)
      : await win.outerSize();
    const originalPosition = isMaximized || isFullscreen
      ? new LogicalPosition(
          Math.floor((logicalScreenWidth - logicalScreenWidth * 0.8) / 2),
          Math.floor((logicalScreenHeight - logicalScreenHeight * 0.8) / 2)
        )
      : await win.outerPosition();

    // 右半分に移動・リサイズ（まだ設定されていない場合）
    if (!isMaximized && !isFullscreen) {
      await win.setSize(
        new LogicalSize(halfWidth, logicalScreenHeight - headerHeightOffset),
      );
      await win.setPosition(
        new LogicalPosition(
          rightPositionX - splitViewRightOffsetPx,
          logicalMonitorY,
        ),
      );

      // ウィンドウの位置調整が完了するまで待つ
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // rapitasウィンドウをアクティブにして、デスクトップの状態を確実にする
    await win.setFocus();

    // システムのデフォルトブラウザで外部リンクを開く
    // ブラウザは通常、最後にアクティブだったウィンドウのサイズを参考にするため、
    // rapitasが右半分にある状態でブラウザが開かれると、左半分に配置される可能性が高い
    await open(url);

    // ブラウザが開いた後、rapitasウィンドウを再度最前面に表示
    // これにより、分割表示の視覚的な一貫性を保つ
    await new Promise((resolve) => setTimeout(resolve, 500));
    await win.setFocus();

    // 手動復元用のウィンドウリサイズリスナー（分割状態から復元したい場合）
    const handleResize = async () => {
      // ユーザーが手動でリサイズした場合、分割表示状態をクリア
      const splitViewData = (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
      if (splitViewData) {
        splitViewData.unlisten();
        delete (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
      }
    };

    // ウィンドウサイズ変更イベントをリッスン
    const unlisten = await win.listen("tauri://resize", handleResize);

    // 分割表示状態を保存して、後で手動復元できるようにする
    const splitViewData: SplitViewData = {
      originalSize,
      originalPosition,
      wasMaximized: isMaximized,
      wasFullscreen: isFullscreen,
      timeout: null as any, // タイムアウトは設定しない
      unlisten,
    };

    // グローバルに保存（手動復元用）
    (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__ = splitViewData;

    // 分割表示が開始されたことを示すカスタムイベントを発火
    // これにより、UIコンポーネントが即座に反応できる
    window.dispatchEvent(
      new CustomEvent("rapitas:split-view-activated", {
        detail: { active: true },
      }),
    );
  } catch (e) {
    console.error("Failed to open external URL in split view:", e);
    // フォールバック: システムのデフォルトブラウザで開く
    openUrlInDefaultBrowser(url);
  } finally {
    // 古いタイムスタンプを定期的にクリーンアップ（1秒以上経過したもの）
    const urlTimestamps = (window as any)
      .__RAPITAS_EXTERNAL_URL_TIMESTAMPS__ as Map<string, number>;
    if (urlTimestamps) {
      const cutoffTime = Date.now() - 1000;
      for (const [storedUrl, timestamp] of Array.from(
        urlTimestamps.entries(),
      )) {
        if (timestamp < cutoffTime) {
          urlTimestamps.delete(storedUrl);
        }
      }
    }
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
 * 分割表示状態を解除し、元のウィンドウ状態に復元する
 */
export async function restoreFromSplitView(): Promise<void> {
  if (!isTauri()) return;

  const splitViewData = (window as ExtendedWindow).__RAPITAS_SPLIT_VIEW__;
  if (!splitViewData) return;

  try {
    const windowModule = await import("@tauri-apps/api/window");
    const win = windowModule.getCurrentWindow() as any;

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
