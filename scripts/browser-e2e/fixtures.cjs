/**
 * browser-e2e/fixtures
 *
 * What every scenario shares: a tiny backend API client for seeding and for
 * reading the truth back, the UI strings (read from the shipped ja catalog so
 * a wording change cannot silently desync the selectors), and the per-page
 * setup — reserved-port guard, first-run setup flag, and the hide-alerts
 * sabotage. Not responsible for any scenario's assertions.
 */
'use strict';

const path = require('node:path');
const { FRONTEND_DIR } = require('./processes.cjs');

/**
 * JSON client for the isolated backend.
 *
 * @param {string} base - Backend origin / バックエンドのオリジン
 * @returns {{get: (p: string) => Promise<any>, post: (p: string, body: object) => Promise<any>}}
 */
function createApi(base) {
  const call = async (method, p, body) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  return { get: (p) => call('GET', p), post: (p, body) => call('POST', p, body) };
}

/**
 * The UI strings the scenarios locate and assert, from messages/ja.json
 * (ja is the default locale).
 *
 * @returns {Record<string, string>} Resolved strings / 解決済みの文言
 * @throws {Error} When a key no longer exists / キーが消えている場合
 */
function loadStrings() {
  const ja = require(path.join(FRONTEND_DIR, 'messages', 'ja.json'));
  const keys = {
    taskNamePlaceholder: 'task.taskNamePlaceholder',
    createSubmit: 'task.createSubmit',
    titleAriaLabel: 'task.compactTaskDetailCard.titleAriaLabel',
    doubleClickToEdit: 'task.inlineEditableText.doubleClickToEdit',
    statusInProgress: 'task.statusInProgress',
    saveFailed: 'common.saveFailed',
    stopAria: 'devMode.executionSection.stopAria',
    stopFailed: 'devMode.executionSection.stopFailed',
    startExecution: 'devMode.executionSection.startExecution',
  };
  const out = {};
  for (const [name, key] of Object.entries(keys)) {
    const value = key.split('.').reduce((o, k) => (o ? o[k] : undefined), ja);
    if (typeof value !== 'string') throw new Error(`messages/ja.json has no string at ${key}`);
    out[name] = value;
  }
  return out;
}

/**
 * Prepare a fresh browser context.
 *
 * @param {import('playwright-core').BrowserContext} context - Fresh context / 新規コンテキスト
 * @param {{reservedHits: string[], sabotage: string|null}} opts - Hit sink and sabotage / 記録先と破壊モード
 * @returns {Promise<void>}
 */
async function prepareContext(context, { reservedHits, sabotage }) {
  // A stale build or a hard-coded URL would send the UI to the developer's
  // live backend. Abort those requests AND record them so the run fails.
  await context.route(
    (url) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) && ['3000', '3001'].includes(url.port),
    async (route) => {
      reservedHits.push(route.request().url());
      await route.abort();
    },
  );
  await context.addInitScript(() => {
    // SetupGate redirects to /setup unless a CLI provider is detected, which
    // CI has none of. The flag is the gate's own "already set up" memo.
    try {
      localStorage.setItem('rapitas:setup-completed', 'true');
    } catch {
      // Storage unavailable: the gate then decides, and scenarios will show it.
    }
  });
  if (sabotage === 'hide-alerts') {
    await context.addInitScript(() => {
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[role="alert"]')) el.remove();
      }).observe(document, { childList: true, subtree: true });
    });
  }
}

/**
 * Whether a request is a call to the isolated backend's path matching `re`.
 *
 * @param {string} apiBase - Backend origin / バックエンドのオリジン
 * @param {RegExp} re - Path pattern / パスのパターン
 * @returns {(url: URL) => boolean} URL predicate for page.route / 判定関数
 */
function apiPath(apiBase, re) {
  const origin = new URL(apiBase).origin;
  return (url) => url.origin === origin && re.test(url.pathname);
}

/**
 * Open a task's detail page and wait for its title to render.
 *
 * @param {import('playwright-core').Page} page - Page / ページ
 * @param {string} frontendBase - Frontend origin / フロントエンドのオリジン
 * @param {number} taskId - Task id / タスクID
 * @param {string} title - Title expected on screen / 表示されるべきタイトル
 * @returns {Promise<import('playwright-core').Locator>} The title display element / タイトル要素
 */
async function openTask(page, frontendBase, taskId, title) {
  // showHeader=true: without it the page drops its header (memory note:
  // task-detail-showheader-rule) — the scenarios want the page as users see it.
  await page.goto(`${frontendBase}/tasks/${taskId}?showHeader=true`, { waitUntil: 'load' });
  const titleEl = page.locator('#td-info').getByText(title, { exact: true }).first();
  await titleEl.waitFor({ state: 'visible', timeout: 30_000 });
  return titleEl;
}

module.exports = { createApi, loadStrings, prepareContext, apiPath, openTask };
