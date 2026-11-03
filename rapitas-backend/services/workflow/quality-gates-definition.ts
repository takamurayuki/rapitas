/**
 * quality-gates-definition
 *
 * Reads .github/quality-gates.json — the one committed definition of which CI
 * checks gate a merge (#1410) — and returns the names the in-app auto-merge
 * must treat as blocking (`required` + `conditional`). NOT responsible for
 * validating the file against the workflows; scripts/gates/quality-gates.cjs
 * does that in CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo-root gates file, resolved from this module (services/workflow → repo root). */
export const QUALITY_GATES_FILE = resolve(import.meta.dir, '../../../.github/quality-gates.json');

/** Modes whose checks block the auto-merge when they are reported. */
const BLOCKING_MODES = new Set(['required', 'conditional']);

export type GateLoadResult = { ok: true; names: string[] } | { ok: false; reason: string };

/**
 * Load the blocking check names from the gates file. Never throws: an
 * unreadable, unparseable or empty definition comes back as `ok: false` with
 * the reason, so the caller can fail closed (merge nothing) and say why.
 *
 * @param file - Path to quality-gates.json / ゲート定義ファイルのパス
 * @returns The blocking names, or why they could not be read. / ブロッキング名か失敗理由
 */
export function loadQualityGateBlockingChecks(file: string = QUALITY_GATES_FILE): GateLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `cannot read ${file}: ${(err as Error).message}` };
  }
  const checks = (parsed as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks)) return { ok: false, reason: `${file} has no "checks" array` };

  const names: string[] = [];
  for (const [i, entry] of checks.entries()) {
    const { name, mode } = (entry ?? {}) as { name?: unknown; mode?: unknown };
    if (typeof name !== 'string' || name.trim() === '' || typeof mode !== 'string') {
      return { ok: false, reason: `${file} checks[${i}] lacks a string name/mode` };
    }
    if (BLOCKING_MODES.has(mode)) names.push(name);
  }
  // An empty set would make every PR 'unknown' and fall through to the
  // merge-state-CLEAN path — i.e. merge without any CI. Treat it as unreadable.
  if (names.length === 0)
    return { ok: false, reason: `${file} lists no required/conditional checks` };
  return { ok: true, names };
}
