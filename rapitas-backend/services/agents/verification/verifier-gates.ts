/**
 * verifier-gates
 *
 * Deterministic static hard/advisory gates: anti-tampering tripwire, coverage
 * (test-alongside-source) requirement, Prisma generated-artifact sync parity
 * and the bug-fix task detector. Runs no subprocesses. Extracted from
 * automated-verifier.ts (file-size split).
 */
import { TEST_FILE_RE } from './related-tests';
import { MAX_DETAIL_CHARS } from './verifier-exec';
import type { VerificationCheck } from './verification-types';

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

/** Files that don't need a paired test (declarations / config / stories). */
const COVERAGE_EXEMPT_RE = /(\.d\.ts$|\.config\.[cm]?[jt]s$|\.stories\.[jt]sx?$)/i;

/**
 * Paths whose modification by an agent counts as GATE TAMPERING: the
 * verification gates themselves, CI workflows, and commit hooks. Reward-hacking
 * research shows agents game checks far more when they can touch the checker
 * (METR o3 eval: ~43x more hacking when the scorer is reachable) and a cheap
 * deterministic tripwire on checker edits catches most hacks (EvilGenie,
 * arXiv:2511.21654). Legitimate self-development changes to these files are
 * allowed only when the (human-approved) plan explicitly lists them.
 */
const PROTECTED_PATH_RE =
  /(services[\\/]agents[\\/]verification[\\/]|services[\\/]workflow[\\/](completion-gate|phase-output-validator|verify-self-repair|phase-critic)|\.github[\\/]workflows[\\/]|\.husky[\\/]|scripts[\\/](pre-commit-check|auto-fix-commit))/i;

/**
 * Bug-fix task detector (conservative — plain 「修正」 alone is too broad).
 * Pure and unit-testable; used to require a reproducing test for bug fixes.
 *
 * @param text - Task title + description. / タスク本文
 * @returns Whether the task looks like a bug fix. / バグ修正らしさ
 */
export function looksLikeBugFixTask(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(バグ|不具合|クラッシュ|例外が|エラーになる|落ちる|表示されない|動かない|\bbug\b|\bcrash\b|\bregression\b|\bbroken\b)/i.test(
    text,
  );
}

/**
 * Deterministic anti-tampering tripwire: fails when the diff touches protected
 * gate/CI/hook paths that the approved plan did not list. Pure and testable.
 *
 * @param allChangedFiles - Every changed file in the diff. / 全変更ファイル
 * @param planFiles - Files the plan declares (null = plan-less mode). / 計画対象
 * @returns A tamper check, or null when no protected file changed. / 判定 or null
 */
export function tamperCheck(
  allChangedFiles: string[],
  planFiles: string[] | null,
): VerificationCheck | null {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const flagged = allChangedFiles.filter((f) => PROTECTED_PATH_RE.test(f));
  if (flagged.length === 0) return null;

  const plan = (planFiles ?? []).map(norm).filter(Boolean);
  const planned = (file: string) => {
    const f = norm(file);
    return plan.some((p) => f === p || f.endsWith(`/${p}`) || p.endsWith(`/${f}`) || f.includes(p));
  };
  const unplanned = flagged.filter((f) => !planned(f));
  const ok = unplanned.length === 0;
  return {
    name: 'tamper',
    ran: true,
    ok,
    errorCount: unplanned.length,
    details: ok
      ? `tamper: ${flagged.length} protected file(s) changed — all listed in the approved plan`
      : `検証ゲート/CI/コミットフック自体への計画外の変更を検出しました。ゲートの改変を含むタスクは自動完了できません（正当な変更であれば plan.md に対象ファイルを明記し承認を得てください）:\n${unplanned
          .slice(0, 20)
          .join('\n')}`.slice(0, MAX_DETAIL_CHARS),
  };
}

/**
 * Coverage gate: a substantive source change must ship with an added/changed
 * test file. Globally OPT-IN (RAPITAS_REQUIRE_TESTS=1) because forcing it on
 * every change blocks legitimate test-free work (docs/config/UI tweaks) — but
 * callers can FORCE it per task (bug fixes: a fix without a reproducing test
 * is exactly the leaky gate SWT-Bench/UTBoost measured). Deterministic.
 *
 * @param changedCodeFiles - Added/modified code files. / 変更コードファイル
 * @param force - Require tests regardless of the env opt-in. / 強制フラグ
 * @returns A coverage check, or null when not applicable. / 判定 or null
 */
export function coverageCheck(changedCodeFiles: string[], force = false): VerificationCheck | null {
  const raw = (process.env.RAPITAS_REQUIRE_TESTS || '').trim().toLowerCase();
  const enabled = force || raw === '1' || raw === 'true' || raw === 'on';
  if (!enabled) return null;

  const tests = changedCodeFiles.filter((f) => TEST_FILE_RE.test(f));
  const sources = changedCodeFiles.filter(
    (f) => !TEST_FILE_RE.test(f) && !COVERAGE_EXEMPT_RE.test(f),
  );
  if (sources.length === 0) return null; // nothing that needs a test
  const ok = tests.length > 0;
  return {
    name: 'coverage',
    ran: true,
    ok,
    errorCount: ok ? 0 : 1,
    details: ok
      ? `coverage: ${tests.length} test file(s) changed alongside source`
      : `ソース変更にテストが伴っていません（テストの追加/更新が必要）:\n${sources
          .slice(0, 40)
          .join('\n')}`.slice(0, MAX_DETAIL_CHARS),
  };
}
