/**
 * browser-e2e/lib
 *
 * Pure helpers for the Browser E2E runner: port guard, verdict, summary,
 * assertion recorder and small path/poll utilities. Owns no processes and no
 * browser — run.cjs and processes.cjs do — so everything here is unit-tested
 * by lib.test.cjs under `node --test`.
 */
'use strict';

const path = require('node:path');

/** Ports owned by the developer's live servers; the runner must never bind or call them. */
const RESERVED_PORTS = Object.freeze([3000, 3001]);

/**
 * Deliberate breakages used to prove each scenario can go red
 * (docs/lessons/gates-that-do-not-measure.md). Never set in CI.
 */
const SABOTAGES = Object.freeze({
  'update-noop': 'PATCH /tasks/:id answers 200 with the merged task but writes nothing',
  'hide-alerts': 'every [role=alert] element is removed from the DOM as soon as it appears',
  'stop-succeeds': 'the stubbed stop endpoint reports success instead of failing',
  'save-passes': 'the failed-save scenario does not inject the failure',
});

/**
 * Refuse a port layout that could touch the live dev servers or collide.
 *
 * @param {{backendPort: number, frontendPort: number}} ports - Chosen ports / 使用ポート
 * @throws {Error} When a port is reserved, invalid or both are equal / 予約済み・不正・重複の場合
 */
function assertSafePorts({ backendPort, frontendPort }) {
  for (const [name, port] of [
    ['backend', backendPort],
    ['frontend', frontendPort],
  ]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`${name} port must be an integer in 1024-65535, got ${port}`);
    }
    if (RESERVED_PORTS.includes(port)) {
      throw new Error(`${name} port ${port} belongs to the live dev server; pick another`);
    }
  }
  if (backendPort === frontendPort) throw new Error('backend and frontend ports must differ');
}

/**
 * Parse a port from the environment without the `parseInt` leniency that
 * reads `32a1` as 32.
 *
 * @param {string|undefined} raw - Env value / 環境変数の値
 * @param {number} fallback - Default port / 既定ポート
 * @returns {number} Port, or NaN when malformed / ポート(不正ならNaN)
 */
function parsePort(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

/**
 * Validate the sabotage switch.
 *
 * @param {string|undefined} raw - BROWSER_E2E_SABOTAGE / 破壊モード指定
 * @returns {string|null} The sabotage id, or null / 破壊モードID
 * @throws {Error} On an unknown id, so a typo cannot silently run the clean suite / 未知のID
 */
function parseSabotage(raw) {
  if (!raw) return null;
  if (!Object.prototype.hasOwnProperty.call(SABOTAGES, raw)) {
    throw new Error(
      `unknown BROWSER_E2E_SABOTAGE "${raw}" (known: ${Object.keys(SABOTAGES).join(', ')})`,
    );
  }
  return raw;
}

/**
 * Deepest directory containing both paths. Turbopack refuses to build when
 * node_modules resolves outside its root, which it does in a git worktree
 * whose node_modules is a junction into the main checkout.
 *
 * @param {string} a - First absolute path / 1つ目の絶対パス
 * @param {string} b - Second absolute path / 2つ目の絶対パス
 * @param {boolean} [caseInsensitive] - Compare case-insensitively (Windows) / 大文字小文字を無視
 * @returns {string} The common ancestor / 共通祖先
 */
function commonAncestor(a, b, caseInsensitive = process.platform === 'win32') {
  const pa = path.resolve(a).split(path.sep);
  const pb = path.resolve(b).split(path.sep);
  const eq = (x, y) => (caseInsensitive ? x.toLowerCase() === y.toLowerCase() : x === y);
  let i = 0;
  while (i < pa.length && i < pb.length && eq(pa[i], pb[i])) i++;
  const joined = pa.slice(0, i).join(path.sep);
  return joined || path.sep;
}

/**
 * A recorder that throws on the first failed expectation and counts the rest,
 * so a scenario that asserted nothing can be told apart from one that passed.
 *
 * @returns {{check: (label: string, ok: boolean, detail?: string) => void, count: () => number}}
 */
function createChecker() {
  let passed = 0;
  return {
    check(label, ok, detail) {
      if (!ok) throw new Error(`expectation failed: ${label}${detail ? ` — ${detail}` : ''}`);
      passed++;
    },
    count: () => passed,
  };
}

/**
 * Decide the run's verdict. Green only when the browser launched, every
 * expected scenario ran, passed and asserted something, and nothing reached
 * a reserved port — "nothing happened" is a failure (#1410).
 *
 * @param {{expected: string[], results: Array<{name: string, status: string, assertions: number}>, browserLaunched: boolean, reservedHits: string[]}} run
 * @returns {{ok: boolean, problems: string[]}} Verdict and reasons / 判定と理由
 */
function evaluateRun({ expected, results, browserLaunched, reservedHits }) {
  const problems = [];
  if (!browserLaunched) problems.push('the browser never launched');
  if (expected.length === 0) problems.push('no scenarios were selected');
  for (const name of expected) {
    const r = results.find((x) => x.name === name);
    if (!r) problems.push(`${name}: did not run`);
    else if (r.status !== 'passed') problems.push(`${name}: ${r.status}`);
    else if (!(r.assertions > 0)) problems.push(`${name}: passed without asserting anything`);
  }
  for (const r of results) {
    if (!expected.includes(r.name)) problems.push(`${r.name}: ran but was not expected`);
  }
  for (const url of reservedHits) problems.push(`request to a reserved port was attempted: ${url}`);
  return { ok: problems.length === 0, problems };
}

/**
 * Render the run as Markdown for $GITHUB_STEP_SUMMARY.
 *
 * @param {{results: Array<{name: string, status: string, assertions: number, ms: number, error?: string}>, verdict: {ok: boolean, problems: string[]}, meta: Record<string, string>}} run
 * @returns {string} Markdown / Markdown文字列
 */
function renderSummary({ results, verdict, meta }) {
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines = [`## Browser E2E — ${verdict.ok ? 'PASS' : 'FAIL'}`, ''];
  for (const [k, v] of Object.entries(meta)) lines.push(`- **${esc(k)}**: ${esc(v)}`);
  lines.push(
    '',
    '| Scenario | Result | Assertions | Time | Detail |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const r of results) {
    const secs = `${(r.ms / 1000).toFixed(1)}s`;
    lines.push(
      `| ${esc(r.name)} | ${r.status} | ${r.assertions} | ${secs} | ${esc(r.error ?? '')} |`,
    );
  }
  if (!verdict.ok) {
    lines.push('', '### Problems', '');
    for (const p of verdict.problems) lines.push(`- ${esc(p)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Poll until `probe` returns a truthy value or the deadline passes.
 *
 * @param {() => Promise<unknown>} probe - Truthy when done; a throw counts as not yet / 完了判定
 * @param {{timeoutMs: number, intervalMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} opts
 * @returns {Promise<{ok: boolean, value: unknown, elapsedMs: number}>} Outcome / 結果
 */
async function pollUntil(probe, { timeoutMs, intervalMs = 500, now = Date.now, sleep }) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = now();
  for (;;) {
    try {
      const value = await probe();
      if (value) return { ok: true, value, elapsedMs: now() - start };
    } catch {
      // Not up yet; the deadline below decides.
    }
    if (now() - start >= timeoutMs) return { ok: false, value: null, elapsedMs: now() - start };
    await wait(intervalMs);
  }
}

/**
 * A bounded sink keeping only the tail of a child's output, where a fatal error lands.
 *
 * @param {number} maxChars - Characters to keep / 保持する文字数
 * @returns {{append: (s: string) => void, read: () => string}}
 */
function createTailBuffer(maxChars) {
  let text = '';
  return {
    append(chunk) {
      text += chunk;
      if (text.length > maxChars) text = text.slice(-maxChars);
    },
    read: () => text,
  };
}

module.exports = {
  RESERVED_PORTS,
  SABOTAGES,
  assertSafePorts,
  parsePort,
  parseSabotage,
  commonAncestor,
  createChecker,
  evaluateRun,
  renderSummary,
  pollUntil,
  createTailBuffer,
};
