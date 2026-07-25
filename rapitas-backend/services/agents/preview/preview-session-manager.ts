/**
 * preview-session-manager
 *
 * Live-preview feature: for a task's latest git worktree, start its dev
 * server (via the same rapitas.runtime.json + app-launcher.ts machinery
 * runtime-smoke verification already uses) and keep a persistent headless
 * browser tab open so the embedded preview panel can repeatedly screenshot
 * it. Unlike runtime-smoke's one-shot verification run, sessions here are
 * long-lived (until explicitly stopped or idle) and held in-process — this
 * module is NOT responsible for verification pass/fail judgement.
 */
import { existsSync } from 'fs';
import { createLogger } from '../../../config/logger';
import { prisma } from '../../../config/database';
import { resolveLatestSessionWorktree } from '../agent-session-resolver';
import {
  allocateFreePort,
  launchApp,
  waitForHealthy,
  type LaunchedApp,
} from '../verification/runtime-smoke/app-launcher';
import { loadRuntimeConfig, substitutePort } from '../verification/runtime-smoke/runtime-config';

const log = createLogger('preview-session');

/** Stop a session after this long without a screenshot request. */
const IDLE_TIMEOUT_MS = 15 * 60_000;
/** How often the sweep checks for idle sessions. */
const SWEEP_INTERVAL_MS = 60_000;

interface PreviewSession {
  app: LaunchedApp;
  browser: import('playwright-core').Browser;
  page: import('playwright-core').Page;
  url: string;
  startedAt: Date;
  lastAccessedAt: Date;
}

const sessions = new Map<number, PreviewSession>();

/**
 * Resources for an in-progress (not yet fully established) startPreview
 * call, keyed by taskId. The dev-server process and headless browser are
 * genuinely slow to spin up (launch, health-poll, navigate — tens of
 * seconds), and the HTTP handler keeps running to completion even after the
 * calling client gives up waiting (a timed-out fetch on the frontend does
 * NOT cancel the in-flight request on the server). Without tracking these
 * as soon as they're created, a client that gives up (navigates away, hits
 * its own timeout) leaves the dev server + browser running forever — never
 * reachable via `sessions` because the attempt never got that far. Every
 * stopPreview/new startPreview call for the task kills whatever's here, so
 * retries self-heal instead of piling up orphaned processes (confirmed live:
 * three abandoned `next dev` instances all fighting over the same `.next`
 * build cache, which is almost certainly why every one of them then hung).
 */
const pending = new Map<
  number,
  { app?: LaunchedApp; browser?: import('playwright-core').Browser }
>();

/** Stop and forget an in-progress launch for a task, if one is tracked. */
async function killPending(taskId: number): Promise<void> {
  const p = pending.get(taskId);
  if (!p) return;
  pending.delete(taskId);
  if (p.browser) await p.browser.close().catch(() => {});
  if (p.app) p.app.stop();
}

/**
 * Stop THIS invocation's own app/browser directly (not via a `pending` map
 * lookup) and remove the map entry only if it still points at these exact
 * resources. Guards against a slow, failing startPreview call for taskId
 * accidentally killing a DIFFERENT, newer startPreview call's already-
 * further-along resources — which a plain `killPending(taskId)` could do if
 * two calls for the same task ever overlap (each call always kills whatever
 * it finds pending/established for the task before starting its own, so
 * this is an edge case, not the common path, but still worth not getting
 * wrong).
 */
async function cleanupOwnAttempt(
  taskId: number,
  app: LaunchedApp,
  browser?: import('playwright-core').Browser,
): Promise<void> {
  if (browser) await browser.close().catch(() => {});
  app.stop();
  if (pending.get(taskId)?.app === app) pending.delete(taskId);
}

/** Reasons startPreview can fail — mapped to a Japanese message by the route layer's caller. */
export type StartPreviewFailureReason =
  | 'no_worktree'
  | 'not_configured'
  | 'config_error'
  | 'unhealthy'
  | 'no_browser'
  | 'error';

export type StartPreviewResult =
  | { ok: true; url: string }
  | { ok: false; reason: StartPreviewFailureReason; message: string };

/**
 * Start (or restart) a preview session for a task: launch its worktree's dev
 * server on a free port and open a persistent headless-browser tab on it.
 * Falls back to the theme's primary working directory when the task has no
 * (or no longer usable) worktree, so a task that hasn't been agent-executed
 * yet can still be previewed — same rapitas.runtime.json mechanism, just
 * pointed at the shared checkout instead of an isolated worktree.
 *
 * @param taskId - Task whose latest worktree to preview. / 対象タスクID
 * @returns The base URL on success, or a typed failure reason + message. / 起動結果
 */
export async function startPreview(taskId: number): Promise<StartPreviewResult> {
  await stopPreview(taskId); // clean up an established session, if any
  await killPending(taskId); // clean up an in-flight attempt, if any (see `pending`)

  const session = await resolveLatestSessionWorktree(taskId);
  let workdir =
    session?.worktreePath && existsSync(session.worktreePath) ? session.worktreePath : null;

  if (!workdir) {
    const task = await prisma.task
      .findUnique({
        where: { id: taskId },
        select: { theme: { select: { workingDirectory: true } } },
      })
      .catch(() => null);
    const themeDir = task?.theme?.workingDirectory;
    if (themeDir && existsSync(themeDir)) {
      log.info(
        { taskId, themeDir },
        '[preview] no worktree for task — falling back to theme working directory',
      );
      workdir = themeDir;
    }
  }

  if (!workdir) {
    return {
      ok: false,
      reason: 'no_worktree',
      message:
        'このタスクのworktreeもテーマの作業ディレクトリも見つかりません。テーマに作業ディレクトリを設定するか、エージェントを一度実行してください。',
    };
  }

  const loaded = await loadRuntimeConfig(workdir);
  if (loaded === null) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'このプロジェクトには rapitas.runtime.json が設定されていません。',
    };
  }
  if (loaded.error || !loaded.config) {
    return {
      ok: false,
      reason: 'config_error',
      message: `rapitas.runtime.json が不正です: ${loaded.error}`,
    };
  }
  const cfg = loaded.config;

  const port = await allocateFreePort();
  const baseUrl = substitutePort(cfg.url, port);
  const app = launchApp(substitutePort(cfg.start, port), workdir, port);
  pending.set(taskId, { app }); // trackable/killable from here on, however this call ends

  const healthy = await waitForHealthy(`${baseUrl}${cfg.healthPath}`, cfg.readyTimeoutMs);
  if (!healthy) {
    await cleanupOwnAttempt(taskId, app);
    return {
      ok: false,
      reason: 'unhealthy',
      message: `アプリが起動しませんでした (${baseUrl}${cfg.healthPath} が無応答)。`,
    };
  }

  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (e) {
    await cleanupOwnAttempt(taskId, app);
    return {
      ok: false,
      reason: 'no_browser',
      message: `playwright-core が利用できません: ${e instanceof Error ? e.message : e}`,
    };
  }

  // System browsers first — no browser download needed on this machine
  // (mirrors browser-smoke.ts).
  let browser: import('playwright-core').Browser | null = null;
  let lastErr = '';
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!browser) {
    await cleanupOwnAttempt(taskId, app);
    return {
      ok: false,
      reason: 'no_browser',
      message: `システムのEdge/Chromeが見つかりません: ${lastErr.slice(0, 200)}`,
    };
  }
  pending.set(taskId, { app, browser });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 25_000 });

    // Ownership check mirrors cleanupOwnAttempt's — only claim the `pending`
    // slot (and hand off to `sessions`) if a newer call hasn't already
    // replaced it out from under this one.
    if (pending.get(taskId)?.app !== app) {
      await browser.close().catch(() => {});
      app.stop();
      return { ok: false, reason: 'error', message: 'superseded by a newer preview request' };
    }
    pending.delete(taskId);
    sessions.set(taskId, {
      app,
      browser,
      page,
      url: baseUrl,
      startedAt: new Date(),
      lastAccessedAt: new Date(),
    });
    log.info({ taskId, baseUrl, port }, '[preview] session started');
    return { ok: true, url: baseUrl };
  } catch (e) {
    await cleanupOwnAttempt(taskId, app, browser);
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stop a task's preview session (dev server + headless browser), AND cancel
 * an in-progress start attempt for the same task if one is still launching
 * (see `pending`) — e.g. the user clicks Stop while the UI is showing
 * "starting...". No-op if neither is present.
 *
 * @param taskId - Task whose preview to stop. / 対象タスクID
 */
export async function stopPreview(taskId: number): Promise<void> {
  const s = sessions.get(taskId);
  if (s) {
    sessions.delete(taskId);
    await s.browser.close().catch(() => {});
    s.app.stop();
    log.info({ taskId }, '[preview] session stopped');
  }
  await killPending(taskId);
}

export interface PreviewStatus {
  active: boolean;
  url?: string;
  startedAt?: string;
}

/**
 * @param taskId - Task to check. / 対象タスクID
 * @returns Whether a preview is running, and since when. / 起動状態
 */
export function getPreviewStatus(taskId: number): PreviewStatus {
  const s = sessions.get(taskId);
  if (!s) return { active: false };
  return { active: true, url: s.url, startedAt: s.startedAt.toISOString() };
}

export type ScreenshotResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: 'not_active' | 'error'; message?: string };

/**
 * Screenshot the task's current preview tab. Re-screenshotting the SAME live
 * page (not re-navigating) lets the image reflect the dev server's own HMR
 * updates between polls, not just the state at start time.
 *
 * @param taskId - Task whose preview to screenshot. / 対象タスクID
 * @returns PNG buffer, or a reason the preview isn't available. / スクリーンショット結果
 */
export async function screenshotPreview(taskId: number): Promise<ScreenshotResult> {
  const s = sessions.get(taskId);
  if (!s) return { ok: false, reason: 'not_active' };
  s.lastAccessedAt = new Date();
  try {
    const buffer = await s.page.screenshot({ type: 'png' });
    return { ok: true, buffer };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// Idle sweep — stop sessions nobody has screenshotted in a while, so a user
// who navigates away without clicking "stop" doesn't leave a dev server (and
// a headless browser) running indefinitely. unref() so this timer alone
// never keeps the process alive.
setInterval(() => {
  const now = Date.now();
  for (const [taskId, s] of sessions) {
    if (now - s.lastAccessedAt.getTime() > IDLE_TIMEOUT_MS) {
      log.info({ taskId }, '[preview] idle session swept');
      void stopPreview(taskId);
    }
  }
}, SWEEP_INTERVAL_MS).unref();
