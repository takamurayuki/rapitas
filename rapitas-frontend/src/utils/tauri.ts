/**
 * Tauri環境の検出とナビゲーションユーティリティ
 */

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
