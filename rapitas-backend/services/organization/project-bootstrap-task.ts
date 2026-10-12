/**
 * project-bootstrap-task
 *
 * Decides whether a generated project is still documents-only, and shapes the
 * one environment-setup task that must land before any feature task.
 *
 * Why this exists. A scaffolded project starts as `docs/requirements.md` +
 * `docs/design.md` and nothing else, and two things then go wrong:
 *
 *  1. Feature tasks get filed into a directory with no manifest, no installed
 *     dependencies and no dev server, so every gate reports "unverified".
 *  2. `runtime-smoke` — the only stage that actually LAUNCHES the app — is
 *     opt-in: automated-verifier runs it solely for projects that register
 *     preview config (`Theme.runtimeConfigJson` or a `rapitas.runtime.json`).
 *     Measured 2026-10-12: neither generated project had either, so all 12 of
 *     TempoRaid's features passed on static checks alone and the shipped app
 *     only ever rendered its upload panel.
 *
 * So the setup task's definition of done includes registering that config: it
 * is what turns runtime verification ON for every feature task that follows.
 *
 * NOT responsible for creating the task, reading the filesystem, or deciding
 * WHEN to file — requirement-intake-job owns all three.
 */

import { sectionLines } from './requirements-task-plan';

/** Title prefix so the task is recognisable and idempotent by title match. */
export const BOOTSTRAP_TASK_PREFIX = '[ENV]';

/** Preview/runtime config filename the verifier looks for. */
export const RUNTIME_CONFIG_FILE = 'rapitas.runtime.json';

/** Inputs for {@link needsEnvironmentBootstrap}. */
export interface BootstrapState {
  /** A dependency manifest exists at the project root. / ルートに manifest がある */
  hasManifest: boolean;
  /** `docs/requirements.md` was readable. / 要件定義書が読めた */
  hasRequirements: boolean;
}

/**
 * Whether this project is still documents-only and needs setting up first.
 *
 * @param state - What the filesystem showed / ファイルシステムの状態
 * @returns True when a setup task should come before feature tasks / 先に環境構築が必要か
 */
export function needsEnvironmentBootstrap(state: BootstrapState): boolean {
  return state.hasRequirements && !state.hasManifest;
}

/** Context for {@link toBootstrapTaskPayload}. */
export interface BootstrapContext {
  themeId: number;
  /** Project name, for the task title. / プロジェクト名 */
  projectName: string;
  /** `docs/design.md`, mined for the concrete stack. / 設計書 */
  design?: string | null;
}

/** The task fields the workflow reads. Mirrors RequirementTaskPayload. */
export interface BootstrapTaskPayload {
  title: string;
  description: string;
  themeId: number;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

/**
 * Lines of the design document's stack section, if it has one.
 *
 * NOTE: the concrete stack is the difference between a setup task that lands
 * and one that stalls. Measured on the two existing setup tasks: TempoRaid's
 * said "設計書に従い、指定の技術スタックで環境構築を行なう" and completed;
 * ContextFlow's said only "要件定義書、設計書に従って実装する。", asked a
 * clarifying question on 2026-10-08 and has sat blocked ever since. Quoting the
 * stack INTO the task removes the round trip.
 *
 * @param design - Design document / 設計書
 * @returns Stack lines, or [] when the section is absent / 技術スタックの行
 */
export function stackLines(design: string | null | undefined): string[] {
  if (!design) return [];
  for (const name of ['技術スタック', 'Tech Stack', '技術選定']) {
    const lines = sectionLines(design, name).filter((l) => l.trim().length > 0);
    if (lines.length > 0) return lines;
  }
  return [];
}

/**
 * Build the environment-setup task for a documents-only project.
 *
 * The criteria are deliberately command-shaped: each one is a command whose
 * exit code decides it, so the completion gate and the diff-review judge can
 * both evaluate them without reading the description.
 *
 * @param ctx - Theme, project name and design document / テーマ・名前・設計書
 * @returns Fields for task creation / タスク作成用のフィールド
 */
export function toBootstrapTaskPayload(ctx: BootstrapContext): BootstrapTaskPayload {
  const stack = stackLines(ctx.design);
  const stackBlock =
    stack.length > 0
      ? `## 設計書が指定している技術スタック\n\n${stack.join('\n')}\n`
      : '## 技術スタック\n\n設計書に技術スタックのセクションがありません。' +
        '設計書の記述から読み取れる範囲で決め、決めた内容と理由を verify.md に明記してください。\n';

  return {
    title: `${BOOTSTRAP_TASK_PREFIX} ${ctx.projectName} の環境構築とプレビュー設定`,
    description:
      `このプロジェクトは現在 \`docs/\` の文書だけで、依存関係の manifest がありません。` +
      `機能の実装タスクはこのタスクが完了するまで起票されません。\n\n` +
      `${stackBlock}\n` +
      `## なぜプレビュー設定まで必要か\n\n` +
      `アプリを実際に起動して確認する検証段階(runtime-smoke)は**オプトイン**で、` +
      `\`${RUNTIME_CONFIG_FILE}\` かテーマのプレビュー設定が登録されているプロジェクトでしか走りません。` +
      `登録が無いと、以降の実装タスクはすべて静的検査(test/lint/typecheck)だけで合格します。` +
      `実測(2026-10-12): 生成プロジェクトはどちらも未登録で、12機能すべてが静的検査だけで通り、` +
      `出来上がったアプリは初期画面しか表示されませんでした。` +
      `ここで登録しておくことが、以降の全タスクで起動確認を有効にする唯一の方法です。`,
    themeId: ctx.themeId,
    goals: [
      '依存関係の manifest と lockfile を作り、インストールが成功する状態にする',
      'typecheck / lint / test / dev サーバー起動のスクリプトを用意する',
      `${RUNTIME_CONFIG_FILE} を作り、以降の実装タスクで起動確認が走るようにする`,
    ],
    constraints: [
      '機能の実装はしない。環境構築とプレビュー設定だけを行う',
      '要件定義書・設計書は変更しない',
      'worktree 内で依存インストールを行う場合、node_modules がリンク共有されている環境では禁止される。' +
        'その場合はプロジェクトルートで用意する',
    ],
    acceptanceCriteria: [
      'プロジェクトルートに依存関係の manifest と lockfile が差分に含まれている',
      '依存インストールのコマンドが exit 0 で完了したことが verify.md に記録されている',
      'typecheck・lint・test の各コマンドが exit 0 で完了したことが verify.md に記録されている' +
        '（テストが0件の場合は、0件であることと理由を明記する）',
      `${RUNTIME_CONFIG_FILE} が差分に含まれ、dev サーバーの起動コマンドと待ち受けURLが記載されている`,
      `dev サーバーを ${RUNTIME_CONFIG_FILE} の設定で起動し、トップ画面が HTTP 200 を返したことが verify.md に記録されている`,
    ],
  };
}
