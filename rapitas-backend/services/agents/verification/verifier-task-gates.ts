/**
 * verifier-task-gates
 *
 * Task-level gates that do not run tooling: the protected-path tamper
 * tripwire, the test-coverage requirement, and the task-text detectors that
 * decide whether tests are required. Split out of automated-verifier.ts
 * (file-size limit, task 1602); does not run lint, tsc or tests.
 */
import { isCoverageExempt, isCoverageTestFile } from './coverage-test-files';
import { MAX_DETAIL_CHARS, type VerificationCheck } from './verification-check-types';

// NOTE: The exempt list moved to coverage-test-files.ts with the test names.
/**
 * Paths whose modification by an agent counts as GATE TAMPERING: the
 * verification gates themselves, CI workflows, and commit hooks. Reward-hacking
 * research shows agents game checks far more when they can touch the checker
 * (METR o3 eval: ~43x more hacking when the scorer is reachable) and a cheap
 * deterministic tripwire on checker edits catches most hacks (EvilGenie,
 * arXiv:2511.21654). Legitimate self-development changes to these files are
 * allowed only when the (human-approved) plan explicitly lists them.
 */
// `phase-critic` is deliberately NOT in the shared prefix group above: unlike
// the other three (each a lone file or a same-named file family, e.g.
// verify-self-repair-budget.ts), phase-critic.ts/phase-critic-gate.ts live in
// a services/workflow/phase-critic/ DIRECTORY alongside unrelated siblings
// (critic-lessons.ts, critic-inflight.ts, critique-aggregator.ts, index.ts).
// A bare `phase-critic` alternative substring-matches the directory prefix
// itself, flagging every file in it as tampering (task 936: critic-lessons.ts
// — lesson distillation, not gate logic — falsely blocked with no plan-less
// override available). Anchor to the actual gate file names instead.
const PROTECTED_PATH_RE =
  /(services[\\/]agents[\\/]verification[\\/]|services[\\/]workflow[\\/](completion-gate|phase-output-validator|verify-self-repair)|services[\\/]workflow[\\/]phase-critic[\\/]phase-critic(-gate)?\.|\.github[\\/]workflows[\\/]|\.husky[\\/]|scripts[\\/](pre-commit-check|auto-fix-commit|primary-guard-hook))/i;

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
 * Trivial-task detector (conservative, same style as {@link looksLikeBugFixTask}):
 * tasks with no testable behavior to cover — pure documentation, comment-only,
 * config-value-only, or dependency-version-only changes. The TDD requirement
 * (R? — full-project TDD adoption) defaults ON for everything else; this is
 * the narrow opt-out, not an opt-in list.
 *
 * @param text - Task title + description. / タスク本文
 * @returns Whether the task looks exempt from the TDD/coverage requirement. / TDD対象外か
 */
export function looksLikeTrivialTask(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(ドキュメントのみ|README(の)?(更新|修正|のみ)|typo\s*(の)?修正|誤字脱字|コメント(のみ|だけ)|設定[値]?(の)?み?変更|依存(関係)?(の)?(バージョン(を)?)?(更新|アップデート)(のみ)?|\bdocs?[\s-]only\b|\breadme\b|\btypo\b|\bcomment[\s-]only\b|\bconfig[\s-]only\b|\bdependency\s+(bump|update)\b)/i.test(
    text,
  );
}

/**
 * Whether a task's diff should be required to ship a test — the TDD gate's
 * scope decision. Default ON for all substantive work (feature/bug/refactor);
 * only tasks {@link looksLikeTrivialTask} identifies as having no testable
 * behavior are exempt. Inverse polarity from the pre-TDD-adoption behavior,
 * which only forced tests for bug fixes ({@link looksLikeBugFixTask}) and left
 * every other task type — most of auto-run's actual volume — untested.
 *
 * @param text - Task title + description. / タスク本文
 * @returns Whether the task requires a test in its diff. / テスト必須か
 */
export function requiresTestsForTask(text: string | null | undefined): boolean {
  return !looksLikeTrivialTask(text);
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

  const tests = changedCodeFiles.filter((f) => isCoverageTestFile(f));
  const sources = changedCodeFiles.filter((f) => !isCoverageTestFile(f) && !isCoverageExempt(f));
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
