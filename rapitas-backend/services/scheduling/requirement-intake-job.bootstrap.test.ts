/**
 * requirement-intake-job.bootstrap.test
 *
 * 文書だけのプロジェクトに環境構築タスクを先行させる配線。親の
 * requirement-intake-job.test.ts は 300 行上限に達したため分離した。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runRequirementIntakeJob,
  MAX_FILES_PER_THEME_RUN,
  MAX_UNSTARTED_PER_THEME,
  type RequirementIntakeDeps,
  type IntakeTheme,
} from './requirement-intake-job';
import { readRequirementsFile } from './requirements-document-reader';
import { BOOTSTRAP_TASK_PREFIX, RUNTIME_CONFIG_FILE } from '../organization/project-bootstrap-task';

/** More features than either cap, for the throttling tests. */
const MANY_FEATURES = [
  '# 機能要件',
  ...Array.from({ length: MAX_FILES_PER_THEME_RUN + 5 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `- [F-${n}] 機能${n}\n  出力: x`;
  }),
].join('\n');

const DOC = [
  '# 機能要件',
  '- [F-01] ログイン',
  '  入力: メール',
  '  出力: セッション',
  '- [F-02] 一覧表示',
  '  出力: 一覧',
  '# 受け入れ基準',
  '- [F-01] Given 未ログイン When 認証 Then セッションが作られる',
  '# スコープ外',
  '- 決済',
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
  /** docs/design.md per working directory. / 設計書 */
  designs?: Record<string, string | null>;
}) {
  const created: Array<{ title: string; themeId: number }> = [];
  const branches: Array<string | null | undefined> = [];
  const deps: RequirementIntakeDeps = {
    listThemes: async () => opts.themes,
    readRequirements: async (dir, branch) => {
      branches.push(branch);
      return opts.docs?.[dir] ?? null;
    },
    readDesign: async (dir) => opts.designs?.[dir] ?? null,
    hasProjectManifest: (dir) => opts.manifests?.[dir] ?? true,
    listExistingTitles: async (themeId) => opts.existing?.[themeId] ?? [],
    countUnstartedTasks: async (themeId) => opts.unstarted?.[themeId] ?? 0,
    createTask: async (payload) => {
      if (opts.failTitles?.includes(payload.title)) throw new Error('boom');
      created.push({ title: payload.title, themeId: payload.themeId });
      return true;
    },
  };
  return { deps, created, branches };
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

  it('manifest があれば従来どおり機能タスクを起票する', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 40, workingDirectory: WD, defaultBranch: 'develop' }],
      docs: { [WD]: MANY_FEATURES },
      manifests: { [WD]: true },
    });

    await runRequirementIntakeJob(deps);

    expect(created.length).toBeGreaterThan(0);
    expect(created.every((c) => !c.title.startsWith(BOOTSTRAP_TASK_PREFIX))).toBe(true);
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
