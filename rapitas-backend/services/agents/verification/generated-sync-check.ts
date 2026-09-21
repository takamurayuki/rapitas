/**
 * generated-sync-check
 *
 * CI-parity checks for the verification gate: things CI hard-fails that the
 * scoped lint/type/test commands cannot see — Prisma generated-artifact sync
 * and the per-file line-limit ratchet. Each is cheap, and catching it here
 * turns a full ci_repair round into an in-phase fix.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VerificationCheck } from './automated-verifier';

const execFileAsync = promisify(execFile);

/** Lines the ratchet script prints for a violation THIS diff is responsible for. */
const RATCHET_FLAG_RE = /^\s*(\d+)\s+(\S+)\s+←\s+(GREW \(was (\d+)\)|NEW)/;

/**
 * File-size ratchet parity check (rapitas repo only): runs the same
 * `scripts/check-large-files.cjs` CI runs, and fails when a file THIS diff
 * changed is over the hard limit and not covered by the baseline, or grew past
 * its baseline snapshot. Task 1027 (2026-09-21) added 7 lines to a baseline
 * file, passed every local check, and spent a ci_repair round on it; the
 * week's CI bounces were mostly this shape. Violations in files the diff did
 * not touch are pre-existing (the base is already red) and do not fail the
 * gate. Fails OPEN (skip) when the script is absent or cannot run.
 *
 * @param workdir - Worktree root (where scripts/ lives). / worktree ルート
 * @param allChanged - Every changed path in the worktree diff. / 全変更パス
 * @returns A 'file-size' check, or null outside the rapitas repo. / チェック結果
 */
export async function fileSizeRatchetCheck(
  workdir: string,
  allChanged: string[],
): Promise<VerificationCheck | null> {
  const script = join(workdir, 'scripts', 'check-large-files.cjs');
  if (!existsSync(script)) return null;
  let stdout = '';
  let failed = false;
  try {
    ({ stdout } = await execFileAsync('node', [script], {
      cwd: workdir,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; killed?: boolean };
    if (typeof e.code !== 'number' || e.killed || typeof e.stdout !== 'string') {
      return {
        name: 'file-size',
        ran: false,
        ok: true,
        errorCount: 0,
        details: 'file-size: ratchet script could not run (skipped)',
      };
    }
    failed = true;
    stdout = e.stdout;
  }
  const changed = new Set(allChanged.map((f) => f.replace(/\\/g, '/')));
  const attributed: string[] = [];
  const preexisting: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = RATCHET_FLAG_RE.exec(line);
    if (!m) continue;
    const [, lines, file, tag, was] = m;
    const note =
      tag === 'NEW'
        ? `${lines} 行（上限 500 行超え・ベースライン外）`
        : `${lines} 行（ベースライン ${was} 行から増加）`;
    (changed.has(file) ? attributed : preexisting).push(`${file}: ${note}`);
  }
  const ok = !failed || attributed.length === 0;
  return {
    name: 'file-size',
    ran: true,
    ok,
    errorCount: attributed.length,
    details: ok
      ? preexisting.length > 0
        ? `file-size: この差分の変更ファイルは ratchet 合格（ベース側の既存超過: ${preexisting.join(', ')}）`
        : 'file-size: within the line-limit ratchet baseline'
      : `行数上限 ratchet 違反（CI の「Enforce per-file line limits」が hard-fail します）: ${attributed.join('; ')}。` +
        ' ベースライン登録ファイルは1行も増やせません — 追加分を新モジュールへ切り出すか、同ファイル内で同じ行数を減らしてください。',
  };
}

/** Generated-artifact drift checks CI's Lint Code job runs, in its order. */
const DRIFT_SCRIPTS: ReadonlyArray<{ script: string; regen: string; what: string }> = [
  { script: 'check:boundary-guide', regen: 'bun run gen:boundary-guide', what: 'boundary guide' },
  { script: 'check:type-guards', regen: 'bun run gen:type-guards', what: 'type guards' },
  {
    script: 'generate:route-barrels:check',
    regen: 'bun run generate:route-barrels',
    what: 'route barrels',
  },
];

/**
 * Run one `bun run <check script>` in the backend package and report drift.
 *
 * @param backendDir - rapitas-backend directory inside the worktree / backend ディレクトリ
 * @param entry - Which drift check / 対象チェック
 * @returns Failure details, or null when in sync or the script is absent / 不一致の詳細
 */
async function runDriftScript(
  backendDir: string,
  entry: (typeof DRIFT_SCRIPTS)[number],
): Promise<string | null> {
  try {
    await execFileAsync('bun', ['run', entry.script], {
      cwd: backendDir,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    return null;
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string; killed?: boolean };
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    // A missing script or a crashed runner is not drift — skip, never fail.
    if (typeof e.code !== 'number' || e.killed || /Script not found/.test(out)) return null;
    const lines = out
      .split(/\r?\n/)
      .filter((l) => /DRIFT|drift|out of sync|missing|stale/i.test(l) && !/no drift/.test(l))
      .slice(0, 6)
      .join(' / ');
    return `${entry.what}: ${lines || 'generated files differ from source'} → rapitas-backend で \`${entry.regen}\` を実行して生成物をコミット`;
  }
}

/**
 * CI-parity checks that only matter for the rapitas repo: the file-size
 * ratchet plus the three generated-artifact drift checks of CI's Lint Code
 * job (boundary guide, type guards, route barrels). Task 1031 (2026-09-22)
 * added a module with new exported types, passed every local check, and
 * spent a ci_repair round on "Check type-guard drift". The drift checks run
 * only when the diff touched rapitas-backend source, and report under the
 * existing 'generated-sync' check name.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path in the worktree diff / 全変更パス
 * @returns Zero or more checks to append to the gate / 追加チェック
 */
export async function ciParityChecks(
  workdir: string,
  allChanged: string[],
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const ratchet = await fileSizeRatchetCheck(workdir, allChanged);
  if (ratchet) checks.push(ratchet);
  const backendDir = join(workdir, 'rapitas-backend');
  const touchesBackend = allChanged.some((f) =>
    /^rapitas-backend[\\/].*\.(ts|tsx)$/.test(f.replace(/\\/g, '/')),
  );
  if (!touchesBackend || !existsSync(join(backendDir, 'package.json'))) return checks;
  const failures = (
    await Promise.all(DRIFT_SCRIPTS.map((entry) => runDriftScript(backendDir, entry)))
  ).filter((f): f is string => f !== null);
  checks.push({
    name: 'generated-sync',
    ran: true,
    ok: failures.length === 0,
    errorCount: failures.length,
    details:
      failures.length === 0
        ? 'generated-sync: boundary guide / type guards / route barrels in sync'
        : `生成物の同期漏れ（CI の「Check … drift」が hard-fail します）: ${failures.join('; ')}`,
  });
  return checks;
}

/**
 * Prisma generated-artifact parity check (rapitas repo only). CI hard-fails
 * when `prisma/schema/*.prisma` changes without the regenerated
 * `prisma/schema.desktop/` + `src/generated/sqlite-init-sql.ts` committed —
 * the single biggest "local verify green → CI Lint Code red" cause. Pure
 * file-list logic: it checks that the generated artifacts changed ALONGSIDE
 * the schema, not that their content matches (CI still does that), so it
 * needs no prisma invocation in the worktree.
 *
 * @param allChanged - Every changed path in the worktree diff. / 全変更パス
 * @returns A 'generated-sync' check, or null when no schema changed. / チェック結果
 */
export function generatedSyncCheck(allChanged: string[]): VerificationCheck | null {
  const norm = allChanged.map((f) => f.replace(/\\/g, '/'));
  const schemaChanged = norm.filter((f) => /(^|\/)prisma\/schema\/[^/]+\.prisma$/.test(f));
  if (schemaChanged.length === 0) return null;
  const desktopChanged = norm.some((f) => f.includes('prisma/schema.desktop/'));
  const initSqlChanged = norm.some((f) => f.endsWith('src/generated/sqlite-init-sql.ts'));
  const ok = desktopChanged && initSqlChanged;
  return {
    name: 'generated-sync',
    ran: true,
    ok,
    errorCount: ok ? 0 : 1,
    details: ok
      ? 'generated-sync: schema change ships with regenerated sqlite artifacts'
      : `Prisma スキーマ変更 (${schemaChanged.join(', ')}) に SQLite 生成物の再生成が伴っていません。` +
        ` rapitas-backend で \`bun run db:prepare:sqlite\` を実行し、` +
        `prisma/schema.desktop/ と src/generated/sqlite-init-sql.ts を同じコミットに含めてください（CI がこの同期を hard-fail します）。`,
  };
}
