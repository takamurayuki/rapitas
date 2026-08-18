/**
 * verifier-typecheck
 *
 * tsc verification check: error-output parsing, the scoped (changed-files-only)
 * fast path with its broken-type-env fallback, and the per-project run.
 * Not responsible for lint/test/format checks. Extracted from
 * automated-verifier.ts (file-size split).
 */
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, relative } from 'path';
import { MAX_DETAIL_CHARS, resolveBin, runCmd } from './verifier-exec';
import { unverifiableCheck, type VerificationCheck } from './verification-types';

/**
 * Extracts tsc error file paths (relative to the project root) from
 * `tsc --noEmit --pretty false` output. Pure — the verifier's testable core.
 */
export function parseTscErrorFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split('\n')) {
    // e.g. "src/foo.ts(12,5): error TS2322: ..."
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+/);
    if (m) files.push(m[1].trim().replace(/\\/g, '/'));
  }
  return files;
}

/** Default-ON kill switch for the scoped (changed-files-only) typecheck. */
function scopedTscEnabled(): boolean {
  const v = (process.env.RAPITAS_VERIFY_SCOPED_TSC ?? '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * TS error codes that mean the type ENVIRONMENT is missing (module / type-defs /
 * node-or-bun global resolution failures), not that the agent's code is wrong.
 * When the scoped (narrow-include) typecheck surfaces ANY of these, the narrowed
 * program dropped an ambient/global provider — the scope is unreliable, so we
 * re-run a FULL typecheck. Falling back is always correctness-safe: a genuine
 * "cannot find module" bug is re-reported by the full run too, so the worst case
 * is slower, never a wrong verdict.
 */
const ENV_FAILURE_TS_CODES = new Set(['TS2307', 'TS2688', 'TS2591', 'TS2580']);

/** True when scoped tsc output carries an env-resolution failure (→ use full). */
function looksLikeBrokenTypeEnv(output: string): boolean {
  for (const m of output.matchAll(/error (TS\d+)/g)) {
    if (ENV_FAILURE_TS_CODES.has(m[1]!)) return true;
  }
  return false;
}

/**
 * Run tsc over ONLY the changed files (+ their transitive imports) instead of the
 * whole project, via a temp tsconfig that extends the project's real config (so
 * strictness/paths/lib are identical). `types: ['bun']` re-supplies the global
 * type environment that the full `include` provides implicitly — without it a
 * narrow include loses node/bun globals. Measured ~6× faster (13.8s → 2.3s on
 * this backend) with an IDENTICAL changed-file error set (verified positive AND
 * negative). Returns the raw tsc output, or null when scoping isn't applicable.
 *
 * @param bin - Resolved tsc binary. / 解決済みtscバイナリ
 * @param projectRoot - Project whose tsconfig.json to extend. / 対象プロジェクト
 * @param relFiles - Changed files, relative to projectRoot. / 変更ファイル(相対)
 * @returns Combined stdout+stderr, or null to fall back to full. / 出力 or null
 */
async function runScopedTypecheck(
  bin: string,
  projectRoot: string,
  relFiles: string[],
): Promise<string | null> {
  // `types: ['bun']` only fits a bun project; for others the global env differs,
  // so skip scoping and let the caller run full (conservative until validated).
  if (!existsSync(join(projectRoot, 'node_modules', 'bun-types'))) return null;

  const cfgPath = join(projectRoot, `.rapitas-verify-scoped-${process.pid}.tsconfig.json`);
  const cfg = {
    extends: './tsconfig.json',
    // incremental:false avoids littering a .tsbuildinfo per run (no speedup for
    // --noEmit anyway, measured).
    compilerOptions: { types: ['bun'], incremental: false },
    include: relFiles.map((f) => f.replace(/\\/g, '/')),
  };
  try {
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const res = await runCmd(`"${bin}" -p "${cfgPath}" --noEmit --pretty false`, projectRoot);
    const out = `${res.stdout}\n${res.stderr}`;
    // Broken scope (dropped globals) → signal a full re-run.
    return looksLikeBrokenTypeEnv(out) ? null : out;
  } catch {
    return null; // any failure → fall back to full
  } finally {
    try {
      unlinkSync(cfgPath);
    } catch {
      /* best-effort */
    }
  }
}

/** Typechecks a project; gates on tsc errors located in the changed files. */
export async function typecheckProject(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): Promise<VerificationCheck | null> {
  if (!existsSync(join(projectRoot, 'tsconfig.json'))) return null;
  const bin = resolveBin(projectRoot, workdir, 'tsc');
  if (!bin) {
    // tsconfig.json present but tsc unresolved → broken setup, fail closed.
    return unverifiableCheck(
      'typecheck',
      'tsconfig.json is present but the tsc binary could not be resolved (worktree node_modules missing?).',
    );
  }
  // Fast path: typecheck only the changed files. Falls through to a FULL run when
  // scoping doesn't apply or looks unreliable — same verdict, just slower.
  const scopedOut = scopedTscEnabled()
    ? await runScopedTypecheck(bin, projectRoot, relFiles)
    : null;
  let combined: string;
  if (scopedOut !== null) {
    combined = scopedOut;
  } else {
    const res = await runCmd(`"${bin}" --noEmit --pretty false`, projectRoot);
    combined = `${res.stdout}\n${res.stderr}`;
  }
  const errorFiles = parseTscErrorFiles(combined);
  // Only count errors located in the files the agent changed (avoids gating on
  // pre-existing type errors elsewhere in the project).
  const changedRel = new Set(
    relFiles.map((f) => relative(projectRoot, join(workdir, f)).replace(/\\/g, '/')),
  );
  const offending = errorFiles.filter((f) => changedRel.has(f));
  const errorCount = offending.length;
  return {
    name: 'typecheck',
    ran: true,
    ok: errorCount === 0,
    errorCount,
    details:
      errorCount === 0
        ? 'tsc --noEmit: no new errors in changed files'
        : `tsc errors in changed files:\n${offending.slice(0, 40).join('\n')}`.slice(
            0,
            MAX_DETAIL_CHARS,
          ),
  };
}
