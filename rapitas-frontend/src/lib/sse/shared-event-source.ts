/**
 * SharedEventSource
 *
 * App-wide singleton SSE connection. Every hook/component that needs server
 * events subscribes through this manager instead of opening its own
 * EventSource — the backend is HTTP/1.1, and Chromium/WebView2 allows only ~6
 * concurrent connections per origin, so per-hook (× per-mount) EventSources
 * starved the pool and froze all other fetches during auto-run.
 *
 * Connects once (lazily) to `/events/subscribe/*` — the backend treats the
 * `*` channel as "all channels" — and dispatches by SSE event type.
 * Not responsible for parsing payloads; handlers receive the raw MessageEvent.
 *
 * When the page is hidden (tray minimize, switching apps), the connection is
 * closed to stop WebView2 SSE→React re-render CPU usage (~10% → ~2%). All
 * state lives in PostgreSQL, so re-subscribing on visibility restores state.
 * Polling hooks already guard on document.hidden via useOnVisible, so no extra
 * state-refresh logic is needed here.
 */
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SharedEventSource');

type EventHandler = (event: MessageEvent) => void;
type ConnectionListener = (connected: boolean) => void;

const RECONNECT_DELAY_MS = 5000;

class SharedEventSourceManager {
  private es: EventSource | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  /** Event types a DOM listener has been requested for (re-bound on reconnect). */
  private boundTypes = new Set<string>();
  private connectionListeners = new Set<ConnectionListener>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while the page is hidden; prevents auto-reconnect until visible again. */
  private paused = false;

  constructor() {
    if (typeof document !== 'undefined') {
      // Primary: browser visibilitychange (covers browser tabs + most Tauri cases).
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.handleHidden();
        } else {
          this.handleVisible();
        }
      });
      // Fallback: Tauri emits rapitas:window-hide/show from Rust's CloseRequested
      // handler and show_main_window(). visibilitychange is unreliable when the
      // host HWND is hidden via ShowWindow(SW_HIDE) without put_IsVisible(false).
      this.setupTauriVisibilityListener();
    }
  }

  /**
   * Subscribe to Tauri-specific window hide/show events as a belt-and-suspenders
   * supplement to the document visibilitychange handler above.
   * No-ops in non-Tauri environments (dynamic import gracefully fails).
   */
  private async setupTauriVisibilityListener(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<null>('rapitas:window-hide', () => {
        logger.debug('SSE pausing via Tauri window-hide event');
        this.handleHidden();
      });
      await listen<null>('rapitas:window-show', () => {
        logger.debug('SSE resuming via Tauri window-show event');
        this.handleVisible();
      });
    } catch {
      // Not in Tauri or event API unavailable — visibilitychange is the fallback.
    }
  }

  /**
   * Subscribe to an SSE event type. Opens the shared connection on first use.
   *
   * @param eventType - SSE `event:` name (e.g. 'shutdown', 'new_notification') / イベント種別
   * @param handler - Receives the raw MessageEvent / 生のMessageEventを受け取るハンドラ
   * @returns Unsubscribe function / 購読解除関数
   */
  subscribe(eventType: string, handler: EventHandler): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);

    this.ensureConnected();
    this.bindType(eventType);

    return () => {
      set.delete(handler);
      // NOTE: The connection intentionally stays open at zero handlers — this is
      // THE app connection; churn from route changes must not reconnect it.
    };
  }

  /**
   * Observe connection state. The listener is invoked immediately with the
   * current state, then on every change.
   *
   * @param listener - Connection state callback / 接続状態コールバック
   * @returns Unsubscribe function / 購読解除関数
   */
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.connected);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /** Whether the shared connection is currently open. / 接続中かどうか */
  isConnected(): boolean {
    return this.connected;
  }

  private handleHidden(): void {
    if (this.paused) return;
    this.paused = true;
    // Cancel any pending reconnect so it doesn't reopen while hidden.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
      logger.debug('SSE paused (window hidden)');
    }
    this.setConnected(false);
  }

  private handleVisible(): void {
    if (!this.paused) return;
    this.paused = false;
    logger.debug('SSE resuming (window visible)');
    this.ensureConnected();
  }

  private ensureConnected(): void {
    if (this.paused || this.es || typeof window === 'undefined') return;

    // `*` subscribes to ALL channels (realtime-service checks subscriptions.has('*')).
    const es = new EventSource(`${API_BASE_URL}/events/subscribe/*`);
    this.es = es;

    es.onopen = () => {
      this.setConnected(true);
    };

    es.onerror = () => {
      this.setConnected(false);
      // EventSource retries on its own while CONNECTING; only a terminal CLOSED
      // state (e.g. the server sent a non-SSE response) needs a manual rebuild.
      if (es.readyState === EventSource.CLOSED) {
        logger.warn('Shared SSE closed — scheduling reconnect');
        this.es = null;
        this.scheduleReconnect();
      }
    };

    // (Re-)attach DOM listeners for every event type requested so far.
    for (const type of this.boundTypes) {
      this.attachListener(es, type);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.paused) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, RECONNECT_DELAY_MS);
  }

  private bindType(eventType: string): void {
    if (this.boundTypes.has(eventType)) return;
    this.boundTypes.add(eventType);
    if (this.es) {
      this.attachListener(this.es, eventType);
    }
  }

  private attachListener(es: EventSource, eventType: string): void {
    // One DOM listener per type per connection; handlers resolve at dispatch
    // time so late subscribers are included without re-attaching.
    es.addEventListener(eventType, (event) => {
      const set = this.handlers.get(eventType);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(event as MessageEvent);
        } catch (err) {
          logger.error(`Handler for '${eventType}' threw:`, err);
        }
      }
    });
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    for (const listener of this.connectionListeners) {
      try {
        listener(connected);
      } catch {
        /* listener errors must not break dispatch */
      }
    }
  }
}

/** The app-wide shared SSE connection. / アプリ全体で共有するSSE接続 */
export const sharedEventSource = new SharedEventSourceManager();
