/**
 * GateMutationPaths
 *
 * Declares which source paths make up the supervision acceptance gate itself.
 * A commit touching them changes the very rule that decides "hands-off", so the
 * streak has to restart rather than count its own landing as quiet time.
 * Not responsible for reading git — callers pass in the changed paths.
 */

/**
 * Path prefixes/suffixes owned by the supervision gate (task 904).
 *
 * NOTE: Keep in sync with the files listed in this task's plan. The
 * self-reset test in acceptance-status-service.test.ts fails if this list
 * stops matching the gate's own sources.
 */
export const GATE_MUTATION_PATHS: readonly string[] = [
  'rapitas-backend/services/supervision/',
  'rapitas-backend/routes/agents/supervision/',
  'rapitas-backend/services/memory/types.ts',
  'rapitas-backend/services/workflow/completion-gate.ts',
  'rapitas-frontend/src/app/agents/supervision/',
] as const;

/** Normalises a path for comparison: POSIX separators, no leading `./`. */
function normalise(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Whether a single changed path belongs to the supervision gate.
 *
 * Matches repo-relative paths (`rapitas-backend/services/supervision/x.ts`) and
 * paths recorded relative to a package root (`services/supervision/x.ts`), since
 * different call sites record diffs from different working directories.
 *
 * @param filePath - Changed file path / 変更されたファイルパス
 * @returns true when the path is part of the gate / ゲート構成ファイルなら true
 */
export function isGateMutationPath(filePath: string): boolean {
  const normalised = normalise(filePath);
  return GATE_MUTATION_PATHS.some((owned) => {
    if (normalised.startsWith(owned)) return true;
    // Tolerate package-relative records by dropping the leading package dir.
    const packageRelative = owned.replace(/^rapitas-(backend|frontend)\/(src\/)?/, '');
    return packageRelative.length > 0 && normalised.startsWith(packageRelative);
  });
}

/**
 * Filters a changed-file list down to the gate-owned paths.
 *
 * @param filePaths - Changed file paths / 変更されたファイルパス一覧
 * @returns Only the paths that mutate the gate / ゲートを変更するパスのみ
 */
export function selectGateMutationPaths(filePaths: readonly string[]): string[] {
  return filePaths.filter((p) => isGateMutationPath(p));
}

export interface GateMutationObservation {
  /** Commit time of the newest commit on HEAD touching a gate path, or null. */
  at: Date | null;
  /** False when git could not be read — the reset signal is then unknown. */
  observable: boolean;
  commit: string | null;
}

/**
 * Reads the newest commit on the running checkout's HEAD that touched the gate.
 *
 * @param cwd - Any directory inside the repository / リポジトリ内のディレクトリ
 * @returns Commit time, or an unobservable marker when git fails / コミット時刻または観測不能
 */
export async function readLastGateMutation(
  cwd: string = process.cwd(),
): Promise<GateMutationObservation> {
  const { execFile } = await import('child_process');
  const run = (args: string[], dir: string): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile('git', args, { cwd: dir, timeout: 15_000, windowsHide: true }, (err, stdout) =>
        err ? reject(err) : resolve(String(stdout).trim()),
      );
    });
  try {
    const root = await run(['rev-parse', '--show-toplevel'], cwd);
    const out = await run(
      ['log', '-1', '--format=%H %cI', 'HEAD', '--', ...GATE_MUTATION_PATHS],
      root,
    );
    if (!out) return { at: null, observable: true, commit: null };
    const [commit, iso] = out.split(' ');
    const at = new Date(iso);
    return Number.isNaN(at.getTime())
      ? { at: null, observable: false, commit: null }
      : { at, observable: true, commit };
  } catch {
    return { at: null, observable: false, commit: null };
  }
}
