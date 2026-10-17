/**
 * screen-task-payload
 *
 * Shapes a parsed screen into the task fields the workflow reads.
 * Not responsible for parsing or for creating the task — callers own both.
 */

import type { ScreenTaskSpec } from './screen-task-plan';
import type { PayloadContext } from './requirements-task-payload';

/** Title prefix the filer dedupes on. */
export const SCREEN_TASK_PREFIX = '[UI]';

/** The task fields this planner sets. */
export interface ScreenTaskPayload {
  title: string;
  description: string;
  themeId: number;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

/**
 * The task title for a screen.
 *
 * Exported so the filer and the outcome classifier dedupe on the SAME string
 * this builder produces, rather than on a second copy of the rule.
 *
 * @param name - Screen name from 画面一覧 / 画面一覧 の画面名
 * @returns The task title / タスク名
 */
export function screenTaskTitle(name: string): string {
  return `${SCREEN_TASK_PREFIX} ${name}`;
}

/**
 * Build the task for one screen.
 *
 * The acceptance criteria are about REACHABILITY, not about a component
 * existing. Measured 2026-10-12 on TempoRaid: every feature shipped with
 * passing unit tests and `store/app-store.ts` declared the four screens, yet
 * nothing mounted them and 11 of 12 features could not be reached. A criterion
 * satisfiable by a component that renders in isolation would reproduce that
 * exactly, so each one starts from launching the app.
 *
 * Behaviour stays with the feature tasks. This task builds the screen, its
 * navigation, and the controls the document lists; the `[F-NN]` tasks then
 * wire behaviour behind those controls. Without that split every feature would
 * have to build its own screen, which is how the screens went unbuilt.
 *
 * @param spec - Parsed screen / 解析済みの画面
 * @param ctx - Theme and document-level limits / テーマと文書全体の制約
 * @returns Fields for task creation / タスク作成用のフィールド
 */
export function toScreenTaskPayload(spec: ScreenTaskSpec, ctx: PayloadContext): ScreenTaskPayload {
  const where = spec.route ? `${spec.name}（${spec.route}）` : spec.name;
  const reached =
    spec.featureIds.length > 0
      ? `この画面から開始する機能: ${spec.featureIds.join(' / ')}。` +
        'それぞれの操作の入口（ボタン・入力欄など）をこのタスクで用意する。中身の実装は各機能のタスクが行う。'
      : 'この画面を名指しする画面導線は要件定義にない。' +
        '画面一覧に書かれた要素と遷移だけを作り、機能の実装には踏み込まない。';

  return {
    title: screenTaskTitle(spec.name),
    themeId: ctx.themeId,
    description: [
      `画面「${where}」を、起動後に実際にたどり着ける状態で作る。`,
      '',
      spec.detail || '(要件定義に説明なし)',
      '',
      reached,
      '',
      `出典: docs/requirements.md の画面一覧「${spec.name}」。設計は docs/design.md、技術選定は docs/adr/ を参照する。`,
      '要件そのものを書き換えたい場合は実装を止めて報告する（文書が正、実装が従）。',
    ].join('\n'),
    goals: [
      `画面「${spec.name}」を実装し、アプリを起動した状態から操作でたどり着けるようにする`,
      '画面一覧に書かれた主要UI要素と画面遷移を実装する',
      'この画面が描画され、遷移が動くことを確認する自動テストを同梱する',
    ],
    constraints: [
      `画面「${spec.name}」の構造と遷移に限定する。` +
        (spec.featureIds.length > 0
          ? `${spec.featureIds.join(' / ')} の処理そのものは各機能のタスクで実装するため、ここでは入口だけを置く。`
          : '機能要件(F-NN)の処理そのものは実装しない。'),
      '他の画面を作り込まない。遷移先がまだ無い場合は、遷移先の雛形だけを置いて別タスクに委ねる。',
      '設計書(docs/design.md)のディレクトリ構成・技術スタックから逸脱しないこと。逸脱が必要なら報告する。',
      'テストを伴わない実装は完了としない（生成直後のプロジェクトには既存テストがほとんど無いため）。',
      ...ctx.outOfScope.map((s) => `スコープ外: ${s}`),
    ],
    acceptanceCriteria: [
      `Given アプリを起動した状態 When 要件定義の画面遷移どおりに操作する Then 画面「${spec.name}」が表示される`,
      `Given 画面「${spec.name}」 When 表示を確認する Then 画面一覧に書かれた主要UI要素がすべて存在する`,
      `Given 差分 When テストを確認する Then 画面「${spec.name}」の描画と遷移を検証するテストが含まれている`,
    ],
  };
}
