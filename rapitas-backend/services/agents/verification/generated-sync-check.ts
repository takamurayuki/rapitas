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
