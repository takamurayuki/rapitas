'use strict';
/**
 * wait-for-frontend-ready
 *
 * Waits until the Next.js dev server actually SERVES a page, and reports
 * progress while it does. Owns only the waiting — it does not start, stop or
 * recycle the frontend (dev.js does).
 *
 * Why an HTTP response and not a port check. Next.js dev opens the listening
 * socket before it compiles anything, and the first request is what triggers
 * the compile. A connect-only probe therefore reports "ready" while the page
 * is still unreachable — which is exactly the symptom this exists to remove:
 * dev.js printed `Frontend :3000` the moment the process was spawned, so
 * opening the screen right after a restart gave an unreachable page with
 * nothing saying to wait. So the probe issues a real GET and lets the request
 * itself be the wait, with a long per-request timeout; repeatedly aborting and
 * re-issuing would keep interrupting the very compile it is waiting for.
 */

/** Status codes that mean the dev server is serving. */
const READY_STATUS_MIN = 200;
/** 404 counts: an unknown route still proves the server is up. 5xx does not. */
const READY_STATUS_MAX = 499;

/** Default ceiling on the whole wait. The first compile of this app is minutes, not seconds. */
const DEFAULT_TIMEOUT_MS = 240_000;
/** Gap between polls once a probe has come back negative. */
const DEFAULT_POLL_INTERVAL_MS = 1_000;
/** How often to say "still waiting" — often enough to not look hung, rarely enough to read. */
const DEFAULT_PROGRESS_EVERY_MS = 10_000;
/**
 * Per-request ceiling. Generous on purpose: during the first compile the dev
 * server holds the request open for tens of seconds and answering IS readiness.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/**
 * One HTTP GET against the dev server's root.
 *
 * @param {number} port Frontend port / フロントのポート
 * @param {number} requestTimeoutMs Per-request ceiling / 1リクエストの上限
 * @returns {Promise<boolean>} Whether it served a page / ページを返したか
 */
function httpProbe(port, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const http = require('http');
  return new Promise((resolve) => {
    // 127.0.0.1, not localhost: on Windows the [::1] attempt is dropped
    // silently and every probe would pay the happy-eyeballs fallback.
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/', timeout: requestTimeoutMs },
      (res) => {
        // Drain: an undrained response keeps the socket open and the next
        // probe would queue behind it.
        res.resume();
        resolve(res.statusCode >= READY_STATUS_MIN && res.statusCode <= READY_STATUS_MAX);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait until the frontend serves a page.
 *
 * Never throws and never rejects: the caller is a startup path that must keep
 * going either way, because the backend is already up and the agent depends on
 * it. A timeout returns `ready: false` so the caller can say so plainly
 * instead of claiming a screen that is not there.
 *
 * @param {object} opts Options / オプション
 * @param {number} opts.port Frontend port / フロントのポート
 * @param {number} [opts.timeoutMs] Whole-wait ceiling / 全体の上限
 * @param {number} [opts.pollIntervalMs] Gap between polls / ポーリング間隔
 * @param {number} [opts.progressEveryMs] Progress log interval / 進捗ログ間隔
 * @param {number} [opts.requestTimeoutMs] Per-request ceiling / 1リクエスト上限
 * @param {(port:number)=>Promise<boolean>} [opts.probe] Injected probe / 差し替え用プローブ
 * @param {()=>number} [opts.now] Injected clock / 時刻
 * @param {(ms:number)=>Promise<void>} [opts.sleep] Injected sleeper / 待機
 * @param {{info:Function,warn:Function}} [opts.log] Logger / ロガー
 * @returns {Promise<{ready:boolean, elapsedMs:number}>} Outcome / 結果
 */
async function waitForFrontendReady(opts) {
  const port = opts.port;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const progressEveryMs = opts.progressEveryMs ?? DEFAULT_PROGRESS_EVERY_MS;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const probe = opts.probe ?? ((p) => httpProbe(p, requestTimeoutMs));
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? console;

  const startedAt = now();
  let lastProgressAt = startedAt;
  // do/while, not while: a zero or negative timeout must still probe once
  // rather than silently skip the check and claim nothing is known.
  do {
    let ok = false;
    try {
      ok = await probe(port);
    } catch {
      ok = false; // not listening yet
    }
    if (ok) {
      const elapsedMs = now() - startedAt;
      log.info(`  ✅ Frontend is serving (http://127.0.0.1:${port}/) after ${Math.round(elapsedMs / 1000)}s`);
      return { ready: true, elapsedMs };
    }
    const elapsed = now() - startedAt;
    if (elapsed - (lastProgressAt - startedAt) >= progressEveryMs) {
      lastProgressAt = now();
      log.info(`  ⏳ フロントエンドの初回コンパイルを待機中… ${Math.round(elapsed / 1000)}s`);
    }
    if (now() - startedAt >= timeoutMs) break;
    await sleep(pollIntervalMs);
  } while (now() - startedAt < timeoutMs);

  const elapsedMs = now() - startedAt;
  log.warn(
    `  ⚠️  フロントエンド(:${port})が ${Math.round(elapsedMs / 1000)}s 以内に応答しませんでした。` +
      '画面はまだ到達不能の可能性があります（バックエンドは稼働中）。',
  );
  return { ready: false, elapsedMs };
}

module.exports = {
  waitForFrontendReady,
  httpProbe,
  READY_STATUS_MIN,
  READY_STATUS_MAX,
  DEFAULT_TIMEOUT_MS,
};
