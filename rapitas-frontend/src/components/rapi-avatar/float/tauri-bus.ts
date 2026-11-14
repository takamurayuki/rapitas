/**
 * tauri-bus
 *
 * The three Tauri calls ラピ's two windows talk through — listen, send to a
 * window, invoke a command — loaded on first use so the browser build never
 * pulls in `@tauri-apps/api`.
 *
 * One seam rather than an `import()` in every effect: each caller stays a
 * synchronous subscribe/unsubscribe, and the tests replace this file instead
 * of the library.
 */

/**
 * Listen for an event; returns the unsubscribe, usable before the listener
 * is even registered.
 *
 * @param event - Event name / イベント名
 * @param handler - Called with each payload / ペイロードを受け取る処理
 * @param onReady - Called once the listener is registered / 登録完了時の処理
 * @returns Unsubscribe / 解除関数
 */
export function onTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
  onReady?: () => void,
): () => void {
  let gone = false;
  let off: (() => void) | null = null;
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<T>(event, (e) => handler(e.payload)))
    .then((unlisten) => {
      if (gone) {
        unlisten();
        return;
      }
      off = unlisten;
      onReady?.();
    })
    .catch(() => {
      /* not in Tauri — nothing to listen to */
    });
  return () => {
    gone = true;
    off?.();
  };
}

/**
 * Send an event to one window.
 *
 * @param target - Window label / 送信先ウィンドウ
 * @param event - Event name / イベント名
 * @param payload - What to send / ペイロード
 */
export function sendToWindow(target: string, event: string, payload?: unknown): void {
  void import('@tauri-apps/api/event')
    .then(({ emitTo }) => emitTo(target, event, payload))
    .catch(() => {});
}

/**
 * Invoke a command of the desktop app, ignoring failure: every caller here
 * is a hint to the Rust side that is re-sent on the next change.
 *
 * @param cmd - Command name / コマンド名
 * @param args - Its arguments / 引数
 */
export function invokeQuietly(cmd: string, args: Record<string, unknown>): void {
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke(cmd, args)).catch(() => {});
}
