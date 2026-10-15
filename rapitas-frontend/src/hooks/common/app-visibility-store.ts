/**
 * app-visibility-store
 *
 * Module-level singleton holding whether the app window is currently
 * minimized (hidden). Not responsible for detecting the native state itself
 * — useAppVisibility owns the Tauri event subscription and calls
 * setAppHidden(); this module only stores and broadcasts the value so that
 * both React components (via useSyncExternalStore) and imperative callers
 * (polling hooks) can read it without each opening their own listener.
 *
 * NOTE: Polling hooks also use subscribeAppHidden() directly (not just
 * getAppHidden()) to trigger an immediate refetch on restore from minimize.
 * document.visibilitychange does not fire for that transition — occlusion is
 * intentionally disabled (see main.rs) — so without this, a poller would
 * only resume at its next scheduled tick (up to its full interval later).
 */

type Listener = () => void;

let hidden = false;
const listeners = new Set<Listener>();

/** Current app-hidden state (imperative read). / 現在のアプリ非表示状態（命令的読み取り） */
export function getAppHidden(): boolean {
  return hidden;
}

/**
 * Updates the app-hidden state and notifies subscribers when it changes.
 *
 * @param value - Whether the app window is minimized/hidden / アプリウィンドウが最小化中かどうか
 */
export function setAppHidden(value: boolean): void {
  if (hidden === value) return;
  hidden = value;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribes to app-hidden state changes. Compatible with useSyncExternalStore.
 *
 * @param listener - Called after every change / 変化のたびに呼ばれるコールバック
 * @returns Unsubscribe function / 購読解除関数
 */
export function subscribeAppHidden(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
