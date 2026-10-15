/**
 * requirement-intake-job.bootstrap.test
 *
 * 文書だけのプロジェクトに環境構築タスクを先行させる配線。親の
 * requirement-intake-job.test.ts は 300 行上限に達したため分離した。
 */
import { describe, it, expect } from 'bun:test';
import {
  runRequirementIntakeJob,
  MAX_FILES_PER_THEME_RUN,
  type RequirementIntakeDeps,
  type IntakeTheme,
} from './requirement-intake-job';
import { BOOTSTRAP_TASK_PREFIX, RUNTIME_CONFIG_FILE } from '../organization/project-bootstrap-task';

/** More features than the per-run cap, so a bootstrap hold is unambiguous. */
const MANY_FEATURES = [
  '# 機能要件',
  ...Array.from({ length: MAX_FILES_PER_THEME_RUN + 5 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `- [F-${n}] 機能${n}\n  出力: x`;
  }),
].join('\n');

function makeDeps(opts: {
  themes: IntakeTheme[];
  docs?: Record<string, string | null>;
  existing?: Record<number, string[]>;
  failTitles?: string[];
  /** Un-started tasks the theme already holds; defaults to none. / 未着手件数 */
  unstarted?: Record<number, number>;
  /** Project roots that already have a dependency manifest; default: all do. / manifest のあるルート */
  manifests?: Record<string, boolean>;
  /** Project roots that already have `rapitas.runtime.json`; default: all do. / プレビュー設定 */
  runtimeConfigs?: Record<string, boolean>;
  /** docs/design.md per working directory. / 設計書 */
  designs?: Record<string, string | null>;
}) {
  const created: Array<{ title: string; themeId: number }> = [];
  const branches: Array<string | null | undefined> = [];
  /** Branch passed when looking the preview config up. / 設定探索に使われたブランチ */
  const branchesAskedForConfig: Array<string | null | undefined> = [];
  const deps: RequirementIntakeDeps = {
    listThemes: async () => opts.themes,
    readRequirements: async (dir, branch) => {
      branches.push(branch);
      return opts.docs?.[dir] ?? null;
    },
    readDesign: async (dir) => opts.designs?.[dir] ?? null,
    hasProjectManifest: (dir) => opts.manifests?.[dir] ?? true,
    hasRuntimeConfigFile: async (dir, branch) => {
      branchesAskedForConfig.push(branch);
      return opts.runtimeConfigs?.[dir] ?? true;
    },
    listExistingTitles: async (themeId) => opts.existing?.[themeId] ?? [],
    countUnstartedTasks: async (themeId) => opts.unstarted?.[themeId] ?? 0,
    createTask: async (payload) => {
      if (opts.failTitles?.includes(payload.title)) throw new Error('boom');
      created.push({ title: payload.title, themeId: payload.themeId });
      return true;
    },
  };
  return { deps, created, branches, branchesAskedForConfig };
}

describe('文書だけのプロジェクトは環境構築を先に起票する (2026-10-12)', () => {
  // 実測の背景: 機能タスクを manifest の無いディレクトリに起票すると全ゲートが
  // 「未検証」を返す。さらに runtime-smoke はプレビュー設定を登録したプロジェクト
  // でしか走らないオプトインなので、未登録のままだと以降の実装が静的検査だけで
  // 通る。TempoRaid の12機能はそれで通り、アプリは初期画面しか出なかった。
  const WD = '/proj/newapp';
  const DESIGN = '# 技術スタック\n\n| FW | Next.js | 16 |\n';

  it('manifest が無ければ環境構築タスクだけを起票し、機能タスクは起票しない', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      designs: { [WD]: DESIGN },
      manifests: { [WD]: false },
    });

    const filed = await runRequirementIntakeJob(deps);

    expect(filed).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith(BOOTSTRAP_TASK_PREFIX)).toBe(true);
    expect(created.some((c) => /\[F-\d+\]/.test(c.title))).toBe(false);
  });

  it('環境構築タスクが既にあれば二重に起票しない（タイトル一致で冪等）', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      designs: { [WD]: DESIGN },
      manifests: { [WD]: false },
      existing: { 40: [`${BOOTSTRAP_TASK_PREFIX} newapp の環境構築とプレビュー設定`] },
    });

    const filed = await runRequirementIntakeJob(deps);

    expect(filed).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('manifest とプレビュー設定が揃っていれば機能タスクを起票する', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      manifests: { [WD]: true },
      runtimeConfigs: { [WD]: true },
    });

    await runRequirementIntakeJob(deps);

    expect(created.length).toBeGreaterThan(0);
    expect(created.every((c) => !c.title.startsWith(BOOTSTRAP_TASK_PREFIX))).toBe(true);
  });

  // 実測 2026-10-12: プロジェクト生成が scaffold を作成時に書き出すため、新規
  // プロジェクトは最初から manifest を持つ。manifest だけで判定していたので
  // [ENV] タスクは決して起票されず、runtime-smoke を有効にする唯一の経路
  // (rapitas.runtime.json の登録)が永久に閉じていた。ContextFlow の再生成でも
  // scaffold 29ファイル中に rapitas.runtime.json は含まれなかった。
  it('manifest があってもプレビュー設定が無ければ環境構築を先に起票する', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      designs: { [WD]: DESIGN },
      manifests: { [WD]: true },
      runtimeConfigs: { [WD]: false },
    });

    const filed = await runRequirementIntakeJob(deps);

    expect(filed).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith(BOOTSTRAP_TASK_PREFIX)).toBe(true);
    expect(created.some((c) => /\[F-\d+\]/.test(c.title))).toBe(false);
  });

  it('テーマ側にプレビュー設定が登録済みなら機能タスクを起票する', async () => {
    // Theme.runtimeConfigJson も runtime-smoke を有効にするので、ファイルが
    // 無いことだけを理由に環境構築をやり直させてはならない。
    const { deps, created } = makeDeps({
      themes: [
        {
          id: 40,
          workingDirectory: WD,
          defaultBranch: 'develop',
          runtimeConfigJson: '{"dev":{"command":"pnpm dev","url":"http://127.0.0.1:3000"}}',
        },
      ],
      docs: { [WD]: MANY_FEATURES },
      manifests: { [WD]: true },
      runtimeConfigs: { [WD]: false },
    });

    await runRequirementIntakeJob(deps);

    expect(created.length).toBeGreaterThan(0);
    expect(created.every((c) => !c.title.startsWith(BOOTSTRAP_TASK_PREFIX))).toBe(true);
  });

  it('空文字の runtimeConfigJson は未登録として扱う', async () => {
    const { deps, created } = makeDeps({
      themes: [
        { id: 40, workingDirectory: WD, defaultBranch: 'develop', runtimeConfigJson: '   ' },
      ],
      docs: { [WD]: MANY_FEATURES },
      designs: { [WD]: DESIGN },
      manifests: { [WD]: true },
      runtimeConfigs: { [WD]: false },
    });

    await runRequirementIntakeJob(deps);

    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith(BOOTSTRAP_TASK_PREFIX)).toBe(true);
  });

  // 実測 2026-10-12: #1212 は rapitas.runtime.json を作って検証も通したが、
  // 成果はタスクブランチに push されただけで main checkout には無い。
  // 設定をワークツリーだけで探していたため「まだ環境構築が必要」と判定され続け、
  // [ENV] のタイトル一致で再起票も抑止されて、機能タスクが無言で永久保留に
  // なった。文書と同じく「正となるブランチ」を見る必要がある。
  it('プレビュー設定は正となるブランチを見て判定する', async () => {
    const { deps, branchesAskedForConfig } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      manifests: { [WD]: true },
    });

    await runRequirementIntakeJob(deps);

    expect(branchesAskedForConfig).toEqual(['develop']);
  });

  it('ワークツリーに無くてもブランチ側にあれば機能タスクへ進む', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      manifests: { [WD]: true },
      // ブランチ側にある状態を表す（探索自体がブランチ優先になった）
      runtimeConfigs: { [WD]: true },
    });

    await runRequirementIntakeJob(deps);

    expect(created.length).toBeGreaterThan(0);
    expect(created.every((c) => !c.title.startsWith(BOOTSTRAP_TASK_PREFIX))).toBe(true);
  });

  it('manifest 済みの場合は「文書だけ」と言わず、作り直さないよう指示する', async () => {
    // 既にある manifest を作り直させると、本当の不足(プレビュー設定)が
    // 片付かないまま差分が膨らむ。
    const payloads: string[] = [];
    const { deps } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      designs: { [WD]: DESIGN },
      manifests: { [WD]: true },
      runtimeConfigs: { [WD]: false },
    });
    const spy: RequirementIntakeDeps = {
      ...deps,
      createTask: async (p) => {
        payloads.push(p.description);
        return true;
      },
    };

    await runRequirementIntakeJob(spy);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).not.toContain('文書だけ');
    expect(payloads[0]).toContain('プレビュー設定が未登録');
    expect(payloads[0]).toContain(RUNTIME_CONFIG_FILE);
  });

  it('環境構築タスクは設計書の技術スタックを引き写す', async () => {
    const payloads: string[] = [];
    const { deps } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      designs: { [WD]: DESIGN },
      manifests: { [WD]: false },
    });
    const spy: RequirementIntakeDeps = {
      ...deps,
      createTask: async (p) => {
        payloads.push(p.description);
        return true;
      },
    };

    await runRequirementIntakeJob(spy);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toContain('Next.js');
    expect(payloads[0]).toContain(RUNTIME_CONFIG_FILE);
  });
});
