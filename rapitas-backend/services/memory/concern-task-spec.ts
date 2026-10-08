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
    // Criterion 3 carries the matching convention for the same reason criteria
    // 1-2 name their artifact: the judge scores it from the diff alone. Rules
    // are tested against the NORMALIZED message (log-health-check.ts's
    // normalizeMessage folds digit runs to `#`, as every existing rule shows),
    // but that normalization lives in another file and never appears in the
    // diff. Without the convention stated here, the judge compares a correct
    // `#` pattern against the raw log text and fails it — measured 2026-09-27
    // on task 1110, whose repair round was spent on that false verdict one
    // minute before its cost ceiling halted the task.
    acceptanceCriteria: [
      'research.md に、ログを出力している箇所が ファイル:行 で記録されている',
      'research.md または verify.md に、欠陥か正常動作かの判定とその根拠が記録されている',
      '欠陥なら修正が差分に入っている、正常動作なら理由付きの抑制ルールが差分に登録されている（抑制ルールの test は正規化後のメッセージと照合される。数字列は `#` に畳まれるため、生ログの数字をそのまま書くのではなく `#` で書くのが正しい）',
    ],
  };
}

/**
 * Spec for a guard-denial concern (source 'guard-incident').
 *
 * Without a template these tasks got LLM-generated criteria, and task 1116's was
 * 「エージェントが同様の primary_mutation タイプの操作を試行しなくなること」.
 * Nothing in a diff can show that: verify correctly marked it 未検証（行動効果）,
 * a requirement_evidence_replan round was spent arguing about it, and the fix it
 * shipped — a paragraph of prompt guidance — then measurably failed. Measured
 * 2026-10-07: 5 primary_mutation incidents before that fix, 1 after it was live.
 *
 * So every criterion here is decidable from the diff or from a named workflow
 * artifact, and none of them asks whether future behaviour changed. Two further
 * lessons are carried over from logHealthSpec: criteria that live in research.md
 * / verify.md say so (the judge only sees the diff, and 944/961/983 failed on
 * that), and the detector is explicitly out of scope — task 1086 answered its
 * own denial by relaxing the hook's regex.
 */
function guardIncidentSpec(): ConcernTaskSpec {
  return {
    goals: [
      '拒否されたコマンドが何をしようとしていたのかを、実行ログとプロンプトから特定する',
      'エージェントがその経路を選んだ理由(現在位置の誤認、絶対パスの既定化など)を特定する',
      '同じ状況で正しい手順に到達できるよう、エージェントが参照する情報を変更する',
    ],
    constraints: [
      '検知器 scripts/primary-guard-hook.cjs の判定ロジック(対象コマンドの判定・拒否条件)を緩めないこと。' +
        'これは防いだ側であり欠陥ではない。拒否メッセージの文面を足すことは許容される。',
      'プロンプトに注意文を1段落足すだけで完了としないこと。実測で効果が確認されていない対処である' +
        '(#1116 は対策稼働中に再発した)。なぜ今回は効くのかを根拠とともに示すこと。',
      '受入基準に「今後〜しなくなること」のような将来の行動を置かないこと。差分から判定できない。',
    ],
    acceptanceCriteria: [
      'research.md に、拒否されたコマンドの全文と、エージェントがその経路を選んだ理由が記録されている',
      'research.md または plan.md に、同じクラスの過去の対処とその実測結果(効いたか否か)が記録されている',
      'エージェントが参照する情報(プロンプト・拒否メッセージ・ガイダンス)の変更が差分に入っており、' +
        '変更後の文面が差分上で読める',
      'verify.md に、その変更がなぜ今回の経路を塞ぐのかの説明と、効果を今後どの実測値で確認するかが記録されている',
    ],
  };
}

/**
 * Spec for a self-detected incident (source 'self_incident_watch').
 *
 * The filer already supplies the state, the threshold it crossed, the evidence
 * lines and a stable signature, so the investigation's shape is known and does
 * not need to be asked for. Without a template the intake gate fired with
 * missing=[goals,constraints,acceptanceCriteria] — #1125 on 2026-10-06 — which
 * costs a human answer and parks the task (median 12.6 min, measured over the
 * 9 questions in the 14 days to 2026-10-07).
 *
 * Same two guards as logHealthSpec: a detector that reported correctly is not
 * the defect, and raising its threshold to silence it is not a fix.
 */
function selfIncidentSpec(): ConcernTaskSpec {
  return {
    goals: [
      '検知された状態(停滞・空回り・誤判定など)を生んだコード経路を ファイル:行 で特定する',
      'それが実際の欠陥か、検知器が正しく報告した正常動作かを判定する',
      '欠陥なら原因を修正し、正常動作なら検知条件を正しくするか抑制の理由を残す',
    ],
    constraints: [
      '検知器の閾値を上げて検知されなくすることを「解消」としないこと。状態が直ったのではなく見えなくなっただけである。',
      '同じ signature の再発を止める機構を示すこと。今回の1件だけを個別に直すのでは足りない。',
      '判定に必要な情報が揃わない場合は、推測で修正せず調査結果を報告して止まること。',
    ],
    acceptanceCriteria: [
      'research.md に、検知された状態を生んだコード経路が ファイル:行 で記録されている',
      'research.md または verify.md に、欠陥か正常動作かの判定とその根拠(証拠行との対応)が記録されている',
      '欠陥なら修正が差分に入っている、検知条件の誤りなら条件の修正が差分に入っている',
      // Worded as "the mechanism that closes the path", not "it will not happen
      // again": the first is decidable from verify.md, the second is the
      // unverifiable future-behaviour shape that cost task 1116 a replan round.
      'verify.md に、同じ signature を生む経路を塞いだ機構が説明されている(将来の観測ではなく機構で示すこと)',
    ],
  };
}

/**
 * Spec for a quality-loop stagnation finding (source 'loop_review').
 *
 * The filer supplies the window, the metric, both windows' counts and rates, and
 * a pointer to GET /backlog/loop-metrics, so the task does not need to ask what
 * to look at. #1123 (2026-10-06) still hit the intake gate missing all three
 * spec fields.
 *
 * The load-bearing choice: a metric task must NOT be given 「指標が改善している」
 * as a criterion. That cannot be decided when the work finishes — it is the same
 * unverifiable shape as task 1116's 「試行しなくなること」, which verify correctly
 * marked 未検証（行動効果）. Requiring the measurement PLAN and the current
 * baseline is decidable from verify.md, and it is what makes the next review
 * able to tell whether the change worked.
 */
function loopReviewSpec(): ConcernTaskSpec {
  return {
    goals: [
      '起票された指標の現在窓の内訳を、該当タスクIDまで降りて分類する',
      '分類のうちどれが偽陽性(ゲートの誤判定)で、どれが本物の失敗かを切り分ける',
      '最も件数の多い原因クラスに対する変更を1つ入れる',
    ],
    constraints: [
      '指標の集計方法や閾値を変えて数字を下げることを「改善」としないこと。',
      '原因クラスを特定できない場合は、分類結果だけを報告して変更を入れずに止まること。' +
        '当て推量の変更は次回の測定を汚染する。',
      '受入基準に「指標が改善している」を置かないこと。完了時点では判定できない。',
    ],
    acceptanceCriteria: [
      'research.md に、現在窓の件数の内訳が原因クラス別に、該当タスクIDつきで記録されている',
      'research.md または plan.md に、偽陽性と本物の失敗の切り分けとその根拠が記録されている',
      '対象とした原因クラスへの変更が差分に入っている',
      'verify.md に、効果を確認する指標名・取得方法(クエリやエンドポイント)と、' +
        '現在値(基準値)が記録されている。改善そのものは次回の測定で判定する',
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
  if (source === 'log_health') return logHealthSpec();
  if (source === 'guard-incident') return guardIncidentSpec();
  if (source === 'self_incident_watch') return selfIncidentSpec();
  if (source === 'loop_review') return loopReviewSpec();
  return null;
}

/**
 * Gate / CI / hook paths guarded by the verifier's anti-tamper tripwire
 * (mirrors PROTECTED_PATH_RE in automated-verifier.ts). A change under these
 * paths passes only when an approved plan.md lists the file — which a
 * lightweight task, having no plan phase, can never produce.
 */
const PROTECTED_STACK_PATH_RE =
  /(services[\\/]agents[\\/]verification[\\/]|services[\\/]workflow[\\/](completion-gate|phase-output-validator|verify-self-repair)|services[\\/]workflow[\\/]phase-critic[\\/]phase-critic(-gate)?\.|\.github[\\/]workflows[\\/]|\.husky[\\/]|scripts[\\/](pre-commit-check|auto-fix-commit|primary-guard-hook))/i;

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

/**
 * The same decision over EVERY concern field that can carry a path.
 *
 * `detail` alone is not enough. convertConcernToTask builds the task body from
 * `detail` plus `対象箇所: {location}`, and the authoritative path lives in
 * `location`: concern 11668 (task 1112, 2026-09-28) carried only the bare
 * filename "phase-output-validator.ts:389" in detail while location held
 * "rapitas-backend/services/workflow/phase-output-validator.ts:389". A bare
 * filename cannot match — the pattern needs the directory to distinguish a
 * guard file from any other — so the task was filed lightweight even though its
 * fix lands under the tamper tripwire, which no lightweight task can satisfy.
 *
 * @param concern - Concern fields that may name a path. / パスを含みうる懸念フィールド
 * @returns true when the fix lands in a protected path. / 保護パスなら true
 */
export function concernNeedsPlanForProtectedPath(
  concern: { detail?: string | null; location?: string | null } | null | undefined,
): boolean {
  if (!concern) return false;
  return needsPlanForProtectedPath([concern.detail, concern.location].filter(Boolean).join('\n'));
}
