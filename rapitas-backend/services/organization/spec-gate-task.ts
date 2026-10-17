/**
 * spec-gate-task
 *
 * Turns the error-severity findings of `checkSpecConsistency` into the one
 * task that must be done before a project's features can be filed.
 * Not responsible for running the check or for filing the task — the intake
 * job owns both, so this stays pure and testable.
 */

import type { SpecFinding } from './spec-consistency';
import { ASSUMPTIONS_SECTION, REACHABILITY_SECTION } from './spec-consistency';

/** Title prefix the filer dedupes on, so only one gate task is ever open. */
export const SPEC_GATE_TASK_PREFIX = '[SPEC]';

/** The task the intake gate files. Mirrors the drift task's shape. */
export interface SpecGateTaskPayload {
  title: string;
  description: string;
  themeId: number;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

/** One finding rendered as a list item, with its feature id when it has one. */
function describeFinding(f: SpecFinding): string {
  return `- ${f.featureId ? `(${f.featureId}) ` : ''}${f.message} [${f.code}]`;
}

/**
 * Turn the blocking findings into one follow-up task.
 *
 * One task, not one per finding: they are the same job — open
 * `docs/requirements.md` and finish it — and N tasks would compete for the
 * single shared auto-run slot. Warnings are deliberately excluded: they do not
 * stop filing, so listing them here would make the blocking set harder to read.
 *
 * @param findings - Result of checkSpecConsistency / 検査結果
 * @param options - Theme the task belongs to / 所属テーマ
 * @returns The payload, or null when nothing blocks / 阻害要因が無ければ null
 */
export function toSpecGateTaskPayload(
  findings: readonly SpecFinding[],
  options: { themeId: number },
): SpecGateTaskPayload | null {
  const errors = findings.filter((f) => f.severity === 'error');
  if (errors.length === 0) return null;

  return {
    title: `${SPEC_GATE_TASK_PREFIX} requirements.md の不足を埋めて実装タスクを起票できる状態にする`,
    description:
      '要件定義書に、実装タスクを起票すると手戻りになる不足がある。' +
      'このタスクが完了するまで `[F-NN]` の機能タスクは1件も起票されない。\n\n' +
      '放置した場合に何が起きるかは実測されている（2026-10-12, TempoRaid）: ' +
      `\`# ${REACHABILITY_SECTION}\` が無い要件定義から12機能を起票し、12件すべてが完了して` +
      'PRもマージされたが、出荷された画面から到達できたのは1機能だけだった。' +
      '受け入れ基準がモジュールの振る舞いしか求めていなかったため、' +
      '単体テストだけで全ゲートを通過できてしまった。\n\n' +
      '解消すべき指摘:\n' +
      errors.map(describeFinding).join('\n') +
      '\n\n各指摘について、推測で埋めるのではなく、決められない項目は' +
      `\`# ${ASSUMPTIONS_SECTION}\` に理由と決める人を書いて残すこと。`,
    themeId: options.themeId,
    goals: [
      '上の指摘をすべて解消するよう docs/requirements.md を更新する',
      `各機能が「どの画面のどの操作から到達するか」を \`# ${REACHABILITY_SECTION}\` に1行ずつ書く`,
    ],
    constraints: [
      '変更するのは docs/ 配下のみ。実装ファイルには手を入れない',
      '機能要件の [F-NN] 番号を振り直さない。既存タスクのタイトルとの対応が取れなくなる',
      '`あとで決める` `画面から利用` のような行で画面導線を埋めない。' +
        '画面（ルートか画面名）と操作（押す/選ぶ/入力する等）の両方を必ず含める',
      '機能を増やさない。不足を埋めるタスクであって、仕様を広げるタスクではない',
    ],
    acceptanceCriteria: [
      `Given 更新後の requirements.md When \`# ${REACHABILITY_SECTION}\` を読む Then 機能要件に宣言された [F-NN] のすべてに、画面と操作を含む行が1行以上ある`,
      'Given 更新後の requirements.md When 受け入れ基準セクションを読む Then 機能要件に宣言された [F-NN] のすべてに Given/When/Then の行が1行以上ある',
      `Given 更新後の requirements.md When \`# ${ASSUMPTIONS_SECTION}\` を読む Then 残っている各行に未解決の理由と決める人が書かれている`,
      'Given 差分 When 変更ファイル一覧を見る Then docs/ 配下のみが変更されている',
    ],
  };
}
