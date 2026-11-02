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
 *
 * Why the response's IDENTITY is checked too. On 2026-10-29 another project's
 * Rails dev server held 127.0.0.1:3000 and answered 200 on `/`. This gate
 * passed on that 200 and announced the frontend as serving, so the rapitas
 * window showed the other project and nothing said why. A readiness check
 * that cannot tell whose server answered is not measuring readiness.
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

/** Appears in this app's own HTML (the root layout's title). */
const APP_MARKER = 'Rapi+';
/** Next.js sends this unless `poweredByHeader` is turned off; this app leaves it on. */
const DEV_SERVER_HEADER = 'x-powered-by';
/** The value that identifies the response as coming from a Next.js server. */
const DEV_SERVER_SIGNATURE = 'next.js';

/**
 * Whose server answered, and whether it is serving.
 *
 * `ready` on the Next.js header alone, not only on the app marker: a compile
 * error is served by OUR dev server with an overlay instead of the app's
 * HTML, and reporting that as someone else's server would turn a build error
 * into a bogus port-conflict report.
 *
 * @param {object} response
 * @param {number} response.statusCode HTTP status / HTTPステータス
 * @param {Record<string,string|string[]|undefined>} response.headers Response headers / レスポンスヘッダ
 * @param {string} response.body Response body, possibly truncated / レスポンス本文（切り詰め可）
 * @returns {'ready'|'not-serving'|'foreign'} What answered / 応答したものの判定
 */
function classifyResponse({ statusCode, headers, body }) {
  if (statusCode < READY_STATUS_MIN || statusCode > READY_STATUS_MAX) return 'not-serving';
  if (typeof body === 'string' && body.includes(APP_MARKER)) return 'ready';
  const powered = headerValue(headers, DEV_SERVER_HEADER);
  if (powered !== null && powered.toLowerCase().includes(DEV_SERVER_SIGNATURE)) return 'ready';
  return 'foreign';
}

/**
 * One header, by a case-insensitive name.
 *
 * Node lower-cases incoming header names, but this is also called with
 * hand-written objects, where the casing is whatever the author typed.
 *
 * @param {Record<string,string|string[]|undefined>} headers Headers / ヘッダ
 * @param {string} name Lower-case header name / 小文字のヘッダ名
 * @returns {string|null} The value, or null / 値、無ければ null
 */
function headerValue(headers, name) {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== name) continue;
    return Array.isArray(value) ? value.join(',') : (value ?? null);
  }
  return null;
}

/**
 * How much of the body to keep while looking for the marker.
 *
 * The marker sits in `<head>`, so a few KB is plenty, and an unbounded read
 * would hold the whole page in memory on every poll.
 */
const BODY_SCAN_LIMIT = 16_384;

/** @typedef {{kind:'ready'|'not-serving'|'foreign', statusCode:number, server:string|null}} ProbeResult */

/**
 * One HTTP GET against the dev server's root.
 *
 * @param {number} port Frontend port / フロントのポート
 * @param {number} requestTimeoutMs Per-request ceiling / 1リクエストの上限
 * @returns {Promise<ProbeResult>} What answered / 応答したものの判定
 */
function httpProbe(port, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const http = require('http');
  const unreachable = { kind: 'not-serving', statusCode: 0, server: null };
  return new Promise((resolve) => {
    // 127.0.0.1, not localhost: on Windows the [::1] attempt is dropped
    // silently and every probe would pay the happy-eyeballs fallback.
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/', timeout: requestTimeoutMs },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const server = headerValue(res.headers, 'server');
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          // Keep consuming after the cap rather than destroying the socket:
          // an undrained response keeps it open and the next probe would
          // queue behind it.
          if (body.length < BODY_SCAN_LIMIT) body += chunk;
        });
        res.on('end', () => {
          resolve({
            kind: classifyResponse({ statusCode, headers: res.headers, body }),
            statusCode,
            server,
          });
        });
        res.on('error', () => resolve(unreachable));
      },
    );
    req.on('error', () => resolve(unreachable));
    req.on('timeout', () => {
      req.destroy();
      resolve(unreachable);
    });
  });
}

/**
 * Accept both probe shapes.
 *
 * The injected probes in the tests — and any caller written before identity
 * checking existed — return a plain boolean.
 *
 * @param {boolean|ProbeResult|null|undefined} result Raw probe result / プローブの生の戻り値
 * @returns {ProbeResult} Normalised result / 正規化した結果
 */
function normalizeProbeResult(result) {
  if (result !== null && typeof result === 'object' && typeof result.kind === 'string') {
    return { statusCode: 0, server: null, ...result };
  }
  return { kind: result ? 'ready' : 'not-serving', statusCode: 0, server: null };
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
    let outcome = { kind: 'not-serving', statusCode: 0, server: null };
    try {
      outcome = normalizeProbeResult(await probe(port));
    } catch {
      // not listening yet
    }
    // Someone else's server will never become ours, so waiting the full
    // ceiling only delays the one message that explains the screen.
    if (outcome.kind === 'foreign') {
      const who = outcome.server ?? 'an unidentified server';
      log.warn(
        `  ❌ ポート ${port} に応答しているのは rapitas のフロントエンドではありません ` +
          `(HTTP ${outcome.statusCode}, Server: ${who})。` +
          'そのプロセスを停止するか別ポートへ移してから、rapitas を起動し直してください。',
      );
      return { ready: false, elapsedMs: now() - startedAt, foreign: outcome };
    }
    if (outcome.kind === 'ready') {
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
  classifyResponse,
  APP_MARKER,
  READY_STATUS_MIN,
  READY_STATUS_MAX,
  DEFAULT_TIMEOUT_MS,
};
