/**
 * runtime-smoke/browser-smoke
 *
 * Drives the app-under-test in a real browser (playwright-core over the
 * system Edge/Chrome — no browser download) and collects hard failure
 * signals: uncaught page errors, console errors, 5xx responses, and a
 * screenshot per checked path (saved to the OS temp dir so worktree diffs
 * stay clean). Fails open when no browser is available — tooling absence
 * must not block every task.
 */
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLogger } from '../../../../config/logger';

const log = createLogger('runtime-smoke:browser');

/** Findings for one checked path. */
export interface PathFinding {
  path: string;
  /** Main-document HTTP status (0 when navigation itself failed). */
  httpStatus: number;
  navigationError: string | null;
  pageErrors: string[];
  consoleErrors: string[];
  /** URLs that answered >= 500 while the page loaded. */
  serverErrors: string[];
  screenshotPath: string | null;
}

export interface SmokeRunResult {
  /** False when playwright/browser could not run at all (fail-open). */
  browserAvailable: boolean;
  unavailableReason?: string;
  findings: PathFinding[];
}

/** Per-page navigation timeout. */
const NAV_TIMEOUT_MS = 25_000;
/** Post-load settle time so async errors surface. */
const SETTLE_MS = 2_000;

/**
 * Run the browser smoke pass over the given paths.
 *
 * @param baseUrl - App base URL (port-substituted) / アプリのベースURL
 * @param paths - Paths to visit / 確認するパス
 * @param label - Artifact label (e.g. task id) / スクリーンショット名の識別子
 * @returns Structured findings / 構造化された所見
 */
export async function runBrowserSmoke(
  baseUrl: string,
  paths: string[],
  label: string,
): Promise<SmokeRunResult> {
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (e) {
    return {
      browserAvailable: false,
      unavailableReason: `playwright-core not installed: ${e instanceof Error ? e.message : e}`,
      findings: [],
    };
  }

  // System browsers first — no browser download needed on this machine.
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
    return {
      browserAvailable: false,
      unavailableReason: `no system Edge/Chrome available: ${lastErr.slice(0, 200)}`,
      findings: [],
    };
  }

  const artifactDir = join(tmpdir(), 'rapitas-runtime-smoke', label);
  await mkdir(artifactDir, { recursive: true }).catch(() => {});

  const findings: PathFinding[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    for (const path of paths) {
      const page = await context.newPage();
      const finding: PathFinding = {
        path,
        httpStatus: 0,
        navigationError: null,
        pageErrors: [],
        consoleErrors: [],
        serverErrors: [],
        screenshotPath: null,
      };
      page.on('pageerror', (err) => finding.pageErrors.push(String(err.message).slice(0, 300)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') finding.consoleErrors.push(msg.text().slice(0, 300));
      });
      page.on('response', (res) => {
        if (res.status() >= 500) finding.serverErrors.push(`${res.status()} ${res.url()}`);
      });

      try {
        const res = await page.goto(`${baseUrl}${path}`, {
          waitUntil: 'load',
          timeout: NAV_TIMEOUT_MS,
        });
        finding.httpStatus = res?.status() ?? 0;
        await page.waitForTimeout(SETTLE_MS);
        const shot = join(artifactDir, `${path.replace(/[^a-zA-Z0-9]+/g, '_') || 'root'}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
        finding.screenshotPath = shot;
      } catch (e) {
        finding.navigationError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      }
      findings.push(finding);
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log.info(
    { baseUrl, paths: paths.length, errors: findings.filter((f) => f.pageErrors.length).length },
    '[runtime-smoke] browser pass finished',
  );
  return { browserAvailable: true, findings };
}
