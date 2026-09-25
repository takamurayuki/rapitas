/**
 * ConcernTaskSpec
 *
 * Supplies the goals / constraints / acceptance criteria a concern-derived task
 * should start life with. Responsible only for choosing that spec from the
 * concern's origin — not for creating the task, and not for judging whether the
 * concern is worth promoting.
 *
 * Concerns filed from the backend log arrive as a logger name, a level and a
 * stack sample. Converted verbatim they produce a task with no spec at all, so
 * the intake gate stops and asks an operator before anything can run (tasks
 * 700 and 702, both 2026-08-27).
 */

/** The spec fields a task can be seeded with. */
export interface ConcernTaskSpec {
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

/**
 * Spec for a concern raised by the log-health check.
 *
 * The constraint is the load-bearing part. A log-derived task can always be
 * "finished" by deleting the line or lowering its level, and task 685 tried
 * exactly that: the ERROR it chased was the verification gate reporting that it
 * had stopped a task — nothing was broken — so with 「ERROR ログが解消」 as the
 * only criterion, suppressing the output was the shortest path to done. The
 * adversarial review caught it, but only after the repair budget was spent.
 *
 * Suppression IS a legitimate outcome here; what it may not be is silent. The
 * criteria therefore accept either a fix or a suppression rule, and demand the
 * reasoning either way.
 */
function logHealthSpec(): ConcernTaskSpec {
  return {
    goals: [
      'このログ行を出力している箇所をコード上で特定する',
      'それが実際の欠陥か、正常動作の報告かを判定する',
      '欠陥なら原因を修正し、正常動作なら理由を添えて抑制ルールに登録する',
    ],
    constraints: [
      'ログ出力の削除・コメントアウト・レベル降格を「解消」としないこと。事象が消えたのではなく、見えなくなっただけである。',
      '抑制する場合は、なぜ何も壊れていないのかを抑制ルールに明記すること。',
      '判定に必要な情報が揃わない場合は、推測で修正せず調査結果を報告して止まること。',
    ],
    // NOTE: Criteria 1-2 name the artifact they live in (research.md /
    // verify.md) on purpose: the diff-review judge only sees the git diff, and
    // with the earlier wording ("…が特定されている") it failed tasks 944/961/983
    // for "the file:line is not shown in the diff". Naming the artifact puts
    // them under the judge's existing "workflow artifacts never appear in the
    // diff → out of jurisdiction" rule; criterion 3 is the one it scores.
    acceptanceCriteria: [
      'research.md に、ログを出力している箇所が ファイル:行 で記録されている',
      'research.md または verify.md に、欠陥か正常動作かの判定とその根拠が記録されている',
      '欠陥なら修正が差分に入っている、正常動作なら理由付きの抑制ルールが差分に登録されている',
    ],
  };
}

/**
 * The spec a concern-derived task should be seeded with, if any.
 *
 * @param source - The concern's origin label. / 懸念の出所ラベル
 * @returns The spec, or null when the origin has no template. / 仕様、無ければ null
 */
export function specForConcernSource(source: string | null | undefined): ConcernTaskSpec | null {
  return source === 'log_health' ? logHealthSpec() : null;
}

/**
 * Gate / CI / hook paths guarded by the verifier's anti-tamper tripwire
 * (mirrors PROTECTED_PATH_RE in automated-verifier.ts). A change under these
 * paths passes only when an approved plan.md lists the file — which a
 * lightweight task, having no plan phase, can never produce.
 */
const PROTECTED_STACK_PATH_RE =
  /(services[\\/]agents[\\/]verification[\\/]|services[\\/]workflow[\\/](completion-gate|phase-output-validator|verify-self-repair)|services[\\/]workflow[\\/]phase-critic[\\/]phase-critic(-gate)?\.|\.github[\\/]workflows[\\/]|\.husky[\\/]|scripts[\\/](pre-commit-check|auto-fix-commit))/i;

/**
 * Whether a concern's fix will land in a protected gate path, so the task must
 * run with a plan phase (standard mode) instead of lightweight.
 *
 * Task 1044 (2026-09-23): a log-derived ERROR whose stack sat in
 * `services/agents/verification/runtime-smoke/` was auto-filed lightweight;
 * the one-line fix was correct, lint/type/test all passed, and the tamper gate
 * still hard-failed it because there was no plan.md to list the file in. The
 * verifier could only ask a question, the auto-adopted answer was "switch to
 * standard mode", and nothing switched it. Decide that at filing time instead.
 *
 * @param detail - Concern detail (log line + stack sample). / 懸念の詳細本文
 * @returns true when the stack/log points into a protected path. / 保護パスなら true
 */
export function needsPlanForProtectedPath(detail: string | null | undefined): boolean {
  return !!detail && PROTECTED_STACK_PATH_RE.test(detail);
}
