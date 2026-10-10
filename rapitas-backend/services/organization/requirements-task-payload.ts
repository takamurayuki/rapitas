/**
 * requirements-task-payload
 *
 * Shapes a parsed `[F-NN]` feature into the task fields the workflow reads.
 * Not responsible for parsing or for creating the task — callers own both.
 */

import type { RequirementTaskSpec } from './requirements-task-plan';

/** Context a spec needs to become a task. */
export interface PayloadContext {
  themeId: number;
  /** The document's explicit non-goals. */
  outOfScope: readonly string[];
}

/** The task fields this planner sets. */
export interface RequirementTaskPayload {
  title: string;
  description: string;
  themeId: number;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

/**
 * Build the task for one feature.
 *
 * NOTE: Two fields decide whether the task can actually land.
 *
 * `acceptanceCriteria` must be judgeable from the DIFF alone: the adversarial
 * diff-review judge receives title, plan, criteria and diff — never the
 * description — so a criterion written as prose about intent, or as a future
 * behaviour, fails every review round. The document's Given/When/Then lines
 * already satisfy that, so they pass through verbatim; when a feature has none,
 * a diff-shaped fallback is supplied rather than leaving the completion gate
 * with nothing to measure.
 *
 * `constraints` must carry the non-goals and pin the work to this one feature.
 * Twelve features are filed at once, so without that pin one task can
 * implement its neighbours and leave the rest with an empty diff — the
 * "差分0件" shape that bounces forever.
 *
 * @param spec - Parsed feature / 解析済みの機能
 * @param ctx - Theme and document-level limits / テーマと文書全体の制約
 * @returns Fields for task creation / タスク作成用のフィールド
 */
export function toTaskPayload(
  spec: RequirementTaskSpec,
  ctx: PayloadContext,
): RequirementTaskPayload {
  const label = `[${spec.id}]`;
  return {
    title: `${label} ${spec.title}`,
    themeId: ctx.themeId,
    description: [
      spec.detail,
      '',
      `出典: docs/requirements.md の機能要件 ${spec.id}。設計は docs/design.md、技術選定は docs/adr/ を参照する。`,
      '要件そのものを書き換えたい場合は実装を止めて報告する（文書が正、実装が従）。',
    ].join('\n'),
    goals: [
      `${spec.id} の「出力」に書かれたものが実際に動作する状態にする`,
      `${spec.id} の振る舞いを検証する自動テストを同梱する`,
    ],
    constraints: [
      `${spec.id} の範囲に限定する。他の機能要件(F-NN)は別タスクなので実装しない。`,
      '設計書(docs/design.md)のデータモデル・API設計から逸脱しないこと。逸脱が必要なら報告する。',
      'テストを伴わない実装は完了としない（生成直後のプロジェクトには既存テストがほとんど無いため）。',
      ...ctx.outOfScope.map((s) => `スコープ外: ${s}`),
    ],
    acceptanceCriteria:
      spec.acceptanceCriteria.length > 0
        ? [...spec.acceptanceCriteria]
        : [
            `${spec.id} の「出力」に相当する実装が差分に含まれ、その振る舞いを確認するテストが差分内に存在する`,
          ],
  };
}
