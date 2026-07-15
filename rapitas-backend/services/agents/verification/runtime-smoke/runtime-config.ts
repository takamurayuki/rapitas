/**
 * runtime-smoke/runtime-config
 *
 * Loads and validates the per-project runtime verification config
 * (`rapitas.runtime.json` at the repo root). The file lives IN the project
 * repo — versioned with the code, present in every worktree checkout — so
 * launch instructions are explicit and deterministic instead of inferred
 * from a README. Its presence is what opts a project into runtime smoke
 * verification.
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

/** File name looked up at the worktree root. */
export const RUNTIME_CONFIG_FILENAME = 'rapitas.runtime.json';

/** Validated runtime verification config. */
export interface RuntimeConfig {
  /** Shell command that starts the app; `{port}` is substituted. */
  start: string;
  /** Base URL the app serves on; `{port}` is substituted. */
  url: string;
  /** Path polled until the app responds (default "/"). */
  healthPath: string;
  /** Max ms to wait for the app to become responsive (default 90s). */
  readyTimeoutMs: number;
  /** Paths driven in the browser smoke pass (default ["/"], max 10). */
  checkPaths: string[];
}

const DEFAULT_READY_TIMEOUT_MS = 90_000;
const MAX_READY_TIMEOUT_MS = 5 * 60_000;
const MAX_CHECK_PATHS = 10;

/**
 * Substitute the `{port}` placeholder.
 *
 * @param template - String possibly containing `{port}` / プレースホルダ付き文字列
 * @param port - Allocated port / 割り当てポート
 * @returns Substituted string / 置換後の文字列
 */
export function substitutePort(template: string, port: number): string {
  return template.split('{port}').join(String(port));
}

/**
 * Parse and validate a rapitas.runtime.json payload.
 *
 * @param raw - File content / ファイル内容
 * @returns Validated config, or an error string / 検証済み設定またはエラー
 */
export function parseRuntimeConfig(raw: string): { config?: RuntimeConfig; error?: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof json !== 'object' || json === null) return { error: 'config must be an object' };
  const o = json as Record<string, unknown>;

  if (typeof o.start !== 'string' || o.start.trim() === '') {
    return { error: '"start" (launch command) is required' };
  }
  if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) {
    return { error: '"url" must be an http(s) URL (use {port} for the allocated port)' };
  }

  const healthPath = typeof o.healthPath === 'string' && o.healthPath ? o.healthPath : '/';
  const rawTimeout = typeof o.readyTimeoutMs === 'number' ? o.readyTimeoutMs : NaN;
  const readyTimeoutMs = Number.isFinite(rawTimeout)
    ? Math.min(MAX_READY_TIMEOUT_MS, Math.max(5_000, rawTimeout))
    : DEFAULT_READY_TIMEOUT_MS;
  const checkPaths = (
    Array.isArray(o.checkPaths)
      ? o.checkPaths.filter((p): p is string => typeof p === 'string' && p.startsWith('/'))
      : []
  ).slice(0, MAX_CHECK_PATHS);

  return {
    config: {
      start: o.start.trim(),
      url: o.url.trim().replace(/\/+$/, ''),
      healthPath,
      readyTimeoutMs,
      checkPaths: checkPaths.length > 0 ? checkPaths : ['/'],
    },
  };
}

/**
 * Load the runtime config from a worktree root.
 *
 * @param workdir - Worktree root directory / worktree ルート
 * @returns Config, a config error, or null when the file is absent / 設定・エラー・無ければnull
 */
export async function loadRuntimeConfig(
  workdir: string,
): Promise<{ config?: RuntimeConfig; error?: string } | null> {
  let raw: string;
  try {
    raw = await readFile(join(workdir, RUNTIME_CONFIG_FILENAME), 'utf8');
  } catch {
    return null; // absent = project not opted in
  }
  return parseRuntimeConfig(raw);
}
