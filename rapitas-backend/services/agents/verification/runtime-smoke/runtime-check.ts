/**
 * runtime-smoke/runtime-check
 *
 * The Evaluator's "actually run it" stage: when a project opts in via
 * rapitas.runtime.json, start the app on a free port, drive it in a real
 * browser, and turn hard failures (won't start / uncaught page errors /
 * 5xx) into a failing VerificationCheck — which the existing verify-repair
 * loop bounces back to the implementer. Console errors are advisory only
 * (dev builds are noisy). Tooling absence (no browser) fails OPEN.
 */
import { createLogger } from '../../../../config/logger';
import type { VerificationCheck } from '../automated-verifier';
import { loadRuntimeConfig, substitutePort } from './runtime-config';
import { allocateFreePort, launchApp, waitForHealthy } from './app-launcher';
import { runBrowserSmoke, type SmokeRunResult } from './browser-smoke';

const log = createLogger('runtime-smoke');

/**
 * Pure verdict over smoke findings — the testable core.
 *
 * @param smoke - Browser pass result / ブラウザ確認の結果
 * @returns ok / errorCount / evidence lines / 判定結果
 */
export function evaluateSmokeFindings(smoke: SmokeRunResult): {
  ok: boolean;
  errorCount: number;
  lines: string[];
} {
  const lines: string[] = [];
  let errorCount = 0;
  for (const f of smoke.findings) {
    if (f.navigationError) {
      errorCount++;
      lines.push(`✗ ${f.path}: ページを開けない — ${f.navigationError}`);
      continue;
    }
    const hard = f.pageErrors.length + f.serverErrors.length;
    if (hard > 0) {
      errorCount += hard;
      lines.push(`✗ ${f.path}: HTTP ${f.httpStatus}`);
      for (const e of f.pageErrors.slice(0, 3)) lines.push(`    pageerror: ${e}`);
      for (const e of f.serverErrors.slice(0, 3)) lines.push(`    server: ${e}`);
    } else {
      lines.push(`✓ ${f.path}: HTTP ${f.httpStatus}`);
    }
    if (f.consoleErrors.length > 0) {
      lines.push(`    (console.error ×${f.consoleErrors.length} — 参考情報、ブロックしません)`);
    }
    if (f.screenshotPath) lines.push(`    screenshot: ${f.screenshotPath}`);
  }
  return { ok: errorCount === 0, errorCount, lines };
}

/**
 * Run the runtime smoke check for a worktree.
 *
 * @param workdir - Agent worktree root / worktree ルート
 * @param label - Artifact label, e.g. `task-123` / 成果物ラベル
 * @returns A 'runtime' VerificationCheck, or null when the project has no
 *          runtime config or the feature is disabled / 対象外なら null
 */
export async function runRuntimeSmokeCheck(
  workdir: string,
  label = 'adhoc',
): Promise<VerificationCheck | null> {
  if (process.env.RAPITAS_RUNTIME_VERIFY === '0') return null;

  const loaded = await loadRuntimeConfig(workdir);
  if (loaded === null) return null; // not opted in
  if (loaded.error || !loaded.config) {
    // A broken config is a REAL failure the implementer can fix.
    return {
      name: 'runtime',
      ran: true,
      ok: false,
      errorCount: 1,
      details: `rapitas.runtime.json が不正です: ${loaded.error}`,
    };
  }
  const cfg = loaded.config;

  const port = await allocateFreePort();
  const baseUrl = substitutePort(cfg.url, port);
  const app = launchApp(substitutePort(cfg.start, port), workdir, port);
  try {
    const healthy = await waitForHealthy(`${baseUrl}${cfg.healthPath}`, cfg.readyTimeoutMs);
    if (!healthy) {
      const tail = app.logs().slice(-25).join('\n');
      return {
        name: 'runtime',
        ran: true,
        ok: false,
        errorCount: 1,
        details:
          `アプリが ${cfg.readyTimeoutMs / 1000}s 以内に起動しませんでした ` +
          `(${baseUrl}${cfg.healthPath} 無応答)。\n--- 起動ログ末尾 ---\n${tail}`,
      };
    }

    const smoke = await runBrowserSmoke(baseUrl, cfg.checkPaths, label);
    if (!smoke.browserAvailable) {
      // Fail-open on tooling: HTTP health already proved the app starts.
      return {
        name: 'runtime',
        ran: true,
        ok: true,
        errorCount: 0,
        details: `起動確認のみ成功 (HTTP応答あり)。ブラウザ確認はスキップ: ${smoke.unavailableReason}`,
      };
    }

    const verdict = evaluateSmokeFindings(smoke);
    return {
      name: 'runtime',
      ran: true,
      ok: verdict.ok,
      errorCount: verdict.errorCount,
      details: verdict.lines.join('\n'),
    };
  } catch (err) {
    // Harness crash (not app failure) — fail open, never block on our own bug.
    log.warn({ err, workdir }, '[runtime-smoke] harness error — skipping (fail-open)');
    return {
      name: 'runtime',
      ran: false,
      ok: true,
      errorCount: 0,
      details: `runtime検証ハーネスの内部エラーによりスキップ: ${err instanceof Error ? err.message : err}`,
    };
  } finally {
    app.stop();
  }
}
