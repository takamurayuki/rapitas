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
import { PORT_PLACEHOLDER, REQUIRED_HOST, RESERVED_PORTS } from './runtime-config-contract';

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
  /**
   * Preview config is registered — `rapitas.runtime.json` or the theme's own
   * `runtimeConfigJson`. Absent is treated as NOT registered.
   * / プレビュー設定が登録済みか（未指定は未登録扱い）
   */
  hasRuntimeConfig?: boolean;
}

/**
 * Whether this project still needs setting up before any feature task.
 *
 * NOTE: preview config counts as part of "set up", not as a nice-to-have.
 * Measured 2026-10-12: project generation now writes its skeleton
 * (`package.json` and friends) at creation, so keying this on the manifest
 * alone made the answer permanently false for every new project — and the setup
 * task is the ONLY thing that registers `rapitas.runtime.json`. Without it
 * runtime-smoke, which is opt-in, never runs, and every feature passes on
 * static checks alone. That is exactly how TempoRaid shipped 12 "implemented"
 * features behind a single upload panel. The two changes landed together and
 * cancelled each other out.
 *
 * @param state - What the filesystem and theme showed / ファイルシステムとテーマの状態
 * @returns True when a setup task should come before feature tasks / 先に環境構築が必要か
 */
export function needsEnvironmentBootstrap(state: BootstrapState): boolean {
  if (!state.hasRequirements) return false;
  return !state.hasManifest || !state.hasRuntimeConfig;
}

/** Context for {@link toBootstrapTaskPayload}. */
export interface BootstrapContext {
  themeId: number;
  /** Project name, for the task title. / プロジェクト名 */
  projectName: string;
  /** `docs/design.md`, mined for the concrete stack. / 設計書 */
  design?: string | null;
  /**
   * Whether a manifest already exists, so the task says what is actually
   * missing. A generated project now starts WITH one, and telling its agent
   * the project is "documents only" would send it to rebuild what is there.
   * / manifest が既にあるか
   */
  hasManifest?: boolean;
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

  // A generated project now ships its skeleton at creation, so the opening
  // line has to say which half is actually missing: told "documents only", an
  // agent rebuilds a manifest that is already there and the real gap (preview
  // config) stays open.
  const situation = ctx.hasManifest
    ? 'このプロジェクトには依存関係の manifest がありますが、プレビュー設定が未登録です。' +
      'manifest と雛形は作り直さず、不足している設定と動作確認を整えてください。'
    : 'このプロジェクトは現在 `docs/` の文書だけで、依存関係の manifest がありません。';

  return {
    title: `${BOOTSTRAP_TASK_PREFIX} ${ctx.projectName} の環境構築とプレビュー設定`,
    description:
      `${situation}` +
      `機能の実装タスクはこのタスクが完了するまで起票されません。\n\n` +
      `${stackBlock}\n` +
      `## なぜプレビュー設定まで必要か\n\n` +
      `アプリを実際に起動して確認する検証段階(runtime-smoke)は**オプトイン**で、` +
      `\`${RUNTIME_CONFIG_FILE}\` かテーマのプレビュー設定が登録されているプロジェクトでしか走りません。` +
      `登録が無いと、以降の実装タスクはすべて静的検査(test/lint/typecheck)だけで合格します。` +
      `実測(2026-10-12): 生成プロジェクトはどちらも未登録で、12機能すべてが静的検査だけで通り、` +
      `出来上がったアプリは初期画面しか表示されませんでした。` +
      `ここで登録しておくことが、以降の全タスクで起動確認を有効にする唯一の方法です。\n\n` +
      `## ポートはハーネスが決める\n\n` +
      `\`start\` と \`url\` のポートは必ず ${PORT_PLACEHOLDER} で書いてください。` +
      `固定すると、ハーネスが割り当てたポートでアプリを起動できず、dev サーバーが自分で` +
      `別のポートを選びます。実測(2026-10-12, task #1212): ポートを 3210 に固定した設定で` +
      `Next.js が既定の 3000 を試し、rapitas のフロントエンドに塞がれていたため自動で` +
      `インクリメントし、\`[::]:${RESERVED_PORTS[1]}\` — rapitas バックエンドのポート — を掴みました。` +
      `\`url\` のホストも ${REQUIRED_HOST} にしてください。localhost は環境によって ::1 に解決され、` +
      `IPv6 側で待ち受けている別プロセスへ接続が横取りされます。`,
    themeId: ctx.themeId,
    goals: [
      ctx.hasManifest
        ? '既存の manifest と整合する lockfile がある状態にする（作り直さない）'
        : '依存関係の manifest と、それを網羅する lockfile を用意する',
      'typecheck / lint / test / dev サーバー起動のスクリプトを用意する',
      `${RUNTIME_CONFIG_FILE} を作り、以降の実装タスクで起動確認が走るようにする`,
    ],
    constraints: [
      '機能の実装はしない。環境構築とプレビュー設定だけを行う',
      '要件定義書・設計書は変更しない',
      ...(ctx.hasManifest
        ? ['既存の manifest と雛形ファイルは作り直さない。不足分だけを足す']
        : []),
      // 実測 2026-10-18 (#1050): install ガードは worktree だけでなく生成
      // プロジェクトのルート自体でも install を拒否する。「その場合はルートで
      // 用意する」と書くと、実装者は逃げ道があると思ってそちらでも拒否されるまで試す。
      '依存インストールは実行しない。worktree でもプロジェクトルートでも実行ガードに拒否される。' +
        '既存の node_modules は用意済みなので `pnpm exec` / `npx` でバイナリを直接使う。' +
        '本当に足りないパッケージがある場合は、その名前と理由を verify.md に事実として書く',
      `${RUNTIME_CONFIG_FILE} でポートを固定しない。ポートは ${PORT_PLACEHOLDER} で受け取り、` +
        `${RESERVED_PORTS.join(' / ')} は rapitas 自身（フロントエンド・バックエンド）が使うため絶対に指定しない`,
      // 実測 2026-10-12 (#1212): 検証者が HTTP 200 を示すために dev サーバーを
      // 手動起動したが、プロセス kill は禁止されているため 6 プロセスが孤児化
      // した。バックグラウンドタスクのタイムアウトは直下の子しか殺さない。
      'dev サーバーを手動で起動しない。プロセスの停止は禁止されているため孤児が残り、' +
        'ポートを掴んだまま以降の起動確認を EADDRINUSE で全滅させる。起動確認はハーネスに任せる',
      // 実測 2026-10-18 (#1058, pnpm 12.9.1): `pnpm run <script> -- --port N` は
      // `--` ごと script に渡り、`$ vite -- --port N` となってポートが無視される。
      // `--` 無しなら `$ vite --port N` で正しく転送される。古い pnpm と逆なので
      // 思い込みで書かず、必ず実機で確かめること。
      `\`start\` はハーネスから渡されたポートを dev サーバー本体まで届ける形にする。` +
        '渡っているかは「ポートを指定して起動し、そのポートで応答する」まで確かめる。' +
        '引数が落ちると dev サーバーは既定ポートで起動し、起動確認は別プロセスを' +
        '見るか EADDRINUSE で倒れる',
      // 実測 2026-10-18 (#1058): タスク worktree の node_modules はメインへの
      // ジャンクションで、pnpm 12 はそれを task run state に使うのを拒否する
      // (ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH)。TempoRaid は start が
      // `pnpm --filter web dev` だったため runtime 検証が一度も起動できず、
      // 11 件が runtime=UNVERIFIED でブロックされた。`pnpm -C <dir> run <script>`
      // と `pnpm exec` は同じ worktree で動くことを実測済み。
      '`start` で `pnpm --filter` や `pnpm -r` を使わない。タスク worktree の node_modules は' +
        'ジャンクションなので、pnpm のワークスペースタスク実行は' +
        'ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH で必ず失敗する。' +
        'モノレポなら `pnpm -C <パッケージのパス> run <script>` を使う',
      // 実測 2026-10-18 (#1058): vite は既定で `localhost` に bind するが、Windows では
      // それが ::1 (IPv6) に解決される。ハーネスは 127.0.0.1 を叩くため、
      // 起動ログに `ready in 917 ms` と出ていても 120s タイムアウトする。
      // `url` のホストを 127.0.0.1 にするだけでは足りない — bind 先を揃える。
      `dev サーバーを ${REQUIRED_HOST} に bind させる（vite なら \`--host ${REQUIRED_HOST}\`）。` +
        '既定の localhost は Windows で ::1 に解決され、IPv4 を叩く起動確認からは' +
        '「起動していない」と見える',
    ],
    acceptanceCriteria: [
      ctx.hasManifest
        ? 'プロジェクトルートの manifest から依存を解決した lockfile が差分に含まれている'
        : 'プロジェクトルートに依存関係の manifest と lockfile が差分に含まれている',
      // 実測 2026-10-18 (#1050): 旧文「依存インストールが exit 0」は同じペイロードの
      // 制約と矛盾しており、誰にも満たせなかった（#1331 はここで質問を出して停止）。
      // 代わりに、worktree 内で実行できて、かつコピーした lockfile では通らない照合を要求する。
      'lockfile が manifest の依存（dependencies / devDependencies）を宣言どおりの' +
        'バージョンで網羅していることを、worktree 内で実行した照合コマンドの出力と' +
        'ともに verify.md に記録する',
      'lockfile を manifest の解決以外の手段で用意した場合、その入手元' +
        '（コピー元のパス等）を verify.md に明記する',
      'typecheck・lint・test の各コマンドが exit 0 で完了したことが verify.md に記録されている' +
        '（テストが0件の場合は、0件であることと理由を明記する）',
      `${RUNTIME_CONFIG_FILE} が差分に含まれ、\`start\` と \`url\` の両方に ${PORT_PLACEHOLDER} があり、` +
        `\`url\` のホストが ${REQUIRED_HOST} である（例: \`"url": "http://${REQUIRED_HOST}:${PORT_PLACEHOLDER}"\`）`,
      `${RESERVED_PORTS.join(' / ')} が ${RUNTIME_CONFIG_FILE} の差分に含まれていない` +
        '（この2つは rapitas 自身が使うため、生成プロジェクトが掴むと rapitas 側が壊れる）',
      `起動確認(runtime-smoke)がこの設定で HTTP 200 を得たことが verify.md に記録されている` +
        '（dev サーバーは自分で起動しない — 起動確認はハーネスが行う）',
    ],
  };
}
