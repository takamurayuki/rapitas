/**
 * requirement-intake-job.screens.test
 *
 * 画面一覧 の画面を機能タスクより先に起票する配線。親の
 * requirement-intake-job.test.ts は 300 行上限に達したため分離した。
 *
 * 画面を先に起票する理由は実測されている（2026-10-12, TempoRaid, 監査 #1244）:
 * 画面一覧に7画面が宣言されていたが1件もタスクにならず、各機能の設計が画面を
 * 自分のスコープ外に出したため、12機能が完了しても画面は2ファイルしか無かった。
 */
import { describe, it, expect } from 'bun:test';
import {
  runRequirementIntakeJob,
  MAX_UNSTARTED_PER_THEME,
  type RequirementIntakeDeps,
  type IntakeTheme,
} from './requirement-intake-job';
import { SCREEN_TASK_PREFIX, screenTaskTitle } from '../organization/screen-task-payload';

/** Everything the spec gate needs, plus a two-screen 画面一覧. */
const DOC = [
  '# 機能要件',
  '- [F-01] ログイン',
  '  出力: セッション',
  '- [F-02] 一覧表示',
  '  出力: 一覧',
  '# 画面一覧',
  '- ログイン画面: メール入力、ログインボタン。成功すると一覧へ遷移。',
  '- 一覧画面: 一覧テーブル、絞り込み。',
  '# 受け入れ基準',
  '- [F-01] Given 未ログイン When 認証 Then セッションが作られる',
  '- [F-02] Given ログイン済み When 一覧を開く Then 一覧が表示される',
  '# 画面導線',
  '- [F-01] ログイン画面 のログインボタンを押す → セッションが作られる',
  '- [F-02] 一覧画面 の一覧タブを開く → 一覧が表示される',
  '# 前提と未決事項',
  '- 同時接続数は未確認。暫定100人とする（決める人: PO）',
].join('\n');

/** The same document with no 画面一覧 at all — today's behaviour must be kept. */
const DOC_NO_SCREENS = DOC.split('\n')
  .filter(
    (l) =>
      l !== '# 画面一覧' &&
      !l.endsWith('画面。') &&
      !l.startsWith('- ログイン画面:') &&
      !l.startsWith('- 一覧画面:'),
  )
  .join('\n');

function makeDeps(opts: { doc: string; existing?: string[]; unstarted?: number }) {
  const themes: IntakeTheme[] = [{ id: 1, workingDirectory: '/proj' }];
  const created: Array<{ title: string; themeId: number; description: string }> = [];
  const deps: RequirementIntakeDeps = {
    listThemes: async () => themes,
    readRequirements: async () => opts.doc,
    readDesign: async () => null,
    hasProjectManifest: () => true,
    hasRuntimeConfigFile: async () => true,
    listExistingTitles: async () => opts.existing ?? [],
    countUnstartedTasks: async () => opts.unstarted ?? 0,
    createTask: async (payload) => {
      created.push({
        title: payload.title,
        themeId: payload.themeId,
        description: payload.description ?? '',
      });
      return true;
    },
  };
  return { deps, created };
}

describe('requirement intake — screen tasks', () => {
  it('files a task per declared screen and no feature task on the same run', async () => {
    const { deps, created } = makeDeps({ doc: DOC });
    await runRequirementIntakeJob(deps);
    expect(created.map((c) => c.title)).toEqual([
      screenTaskTitle('ログイン画面'),
      screenTaskTitle('一覧画面'),
    ]);
    expect(created.some((c) => c.title.startsWith('[F-'))).toBe(false);
  });

  it('resumes feature filing once every screen has a task', async () => {
    const { deps, created } = makeDeps({
      doc: DOC,
      existing: [screenTaskTitle('ログイン画面'), screenTaskTitle('一覧画面')],
    });
    await runRequirementIntakeJob(deps);
    expect(created.map((c) => c.title)).toEqual(['[F-01] ログイン', '[F-02] 一覧表示']);
  });

  it('holds the features back while even one screen is unfiled', async () => {
    const { deps, created } = makeDeps({
      doc: DOC,
      existing: [screenTaskTitle('ログイン画面')],
    });
    await runRequirementIntakeJob(deps);
    expect(created.map((c) => c.title)).toEqual([screenTaskTitle('一覧画面')]);
  });

  it('files no duplicate when the screen task already exists', async () => {
    const { deps, created } = makeDeps({
      doc: DOC,
      existing: [screenTaskTitle('ログイン画面'), screenTaskTitle('一覧画面')],
    });
    await runRequirementIntakeJob(deps);
    expect(created.some((c) => c.title.startsWith(SCREEN_TASK_PREFIX))).toBe(false);
  });

  it('tells the screen task which features must start from it', async () => {
    const { deps, created } = makeDeps({ doc: DOC });
    await runRequirementIntakeJob(deps);
    expect(created[0].description).toContain('F-01');
    expect(created[0].description).toContain('メール入力');
  });

  it('behaves exactly as before when the document declares no screens', async () => {
    const { deps, created } = makeDeps({ doc: DOC_NO_SCREENS });
    await runRequirementIntakeJob(deps);
    expect(created.map((c) => c.title)).toEqual(['[F-01] ログイン', '[F-02] 一覧表示']);
  });

  it('respects the outstanding-backlog cap while filing screens', async () => {
    const { deps, created } = makeDeps({ doc: DOC, unstarted: MAX_UNSTARTED_PER_THEME - 1 });
    await runRequirementIntakeJob(deps);
    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith(SCREEN_TASK_PREFIX)).toBe(true);
  });

  it('files nothing at all when the theme is already at the cap', async () => {
    const { deps, created } = makeDeps({ doc: DOC, unstarted: MAX_UNSTARTED_PER_THEME });
    await runRequirementIntakeJob(deps);
    expect(created).toHaveLength(0);
  });
});
