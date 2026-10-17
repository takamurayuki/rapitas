/**
 * requirement-intake-job.spec-gate.test
 *
 * 要件定義に不備がある間、機能タスクを1件も起票しない配線。親の
 * requirement-intake-job.test.ts は 300 行上限に達したため分離した。
 *
 * このゲートが存在する理由は実測されている（2026-10-12, TempoRaid, 監査 #1244）:
 * `# 画面導線` の無い requirements.md から12機能を起票し、12件すべてが完了して
 * PRもマージされたが、出荷された画面から到達できたのは1機能だけだった。
 */
import { describe, it, expect } from 'bun:test';
import {
  runRequirementIntakeJob,
  type RequirementIntakeDeps,
  type IntakeTheme,
} from './requirement-intake-job';
import { SPEC_GATE_TASK_PREFIX } from '../organization/spec-gate-task';

/** A document with no error-severity finding. */
const DOC = [
  '# 機能要件',
  '- [F-01] ログイン',
  '  出力: セッション',
  '- [F-02] 一覧表示',
  '  出力: 一覧',
  '# 受け入れ基準',
  '- [F-01] Given 未ログイン When 認証 Then セッションが作られる',
  '- [F-02] Given ログイン済み When 一覧を開く Then 一覧が表示される',
  '# 画面導線',
  '- [F-01] /login のログインボタンを押す → セッションが作られる',
  '- [F-02] /list の一覧タブを開く → 一覧が表示される',
  '# 前提と未決事項',
  '- 同時接続数は未確認。暫定100人とする（決める人: PO）',
].join('\n');

/** The same document without its 画面導線 section — TempoRaid's shape. */
const DOC_WITHOUT_REACHABILITY = DOC.split('\n')
  .filter((l) => !l.startsWith('# 画面導線') && !l.includes(' → '))
  .join('\n');

function makeDeps(opts: {
  docs: Record<string, string>;
  existing?: Record<number, string[]>;
  /** Project roots that already carry a dependency manifest; default: all do. */
  manifests?: Record<string, boolean>;
  /** Project roots that already carry rapitas.runtime.json; default: all do. */
  runtimeConfigs?: Record<string, boolean>;
}) {
  const themes: IntakeTheme[] = [{ id: 1, workingDirectory: '/proj' }];
  const created: Array<{ title: string; themeId: number; description: string }> = [];
  const deps: RequirementIntakeDeps = {
    listThemes: async () => themes,
    readRequirements: async (dir) => opts.docs[dir] ?? null,
    readDesign: async () => null,
    hasProjectManifest: (dir) => opts.manifests?.[dir] ?? true,
    hasRuntimeConfigFile: async (dir) => opts.runtimeConfigs?.[dir] ?? true,
    listExistingTitles: async (themeId) => opts.existing?.[themeId] ?? [],
    countUnstartedTasks: async () => 0,
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

describe('requirement intake — spec gate', () => {
  it('files one [SPEC] task and no feature task when the document has an error', async () => {
    const { deps, created } = makeDeps({ docs: { '/proj': DOC_WITHOUT_REACHABILITY } });
    expect(await runRequirementIntakeJob(deps)).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith(SPEC_GATE_TASK_PREFIX)).toBe(true);
    expect(created[0].themeId).toBe(1);
  });

  it('names the blocking findings, so the author needs no second tool to act', async () => {
    const { deps, created } = makeDeps({ docs: { '/proj': DOC_WITHOUT_REACHABILITY } });
    await runRequirementIntakeJob(deps);
    expect(created[0].description).toContain('missing_reachability_section');
  });

  it('files the features as before when the document is complete', async () => {
    const { deps, created } = makeDeps({ docs: { '/proj': DOC } });
    await runRequirementIntakeJob(deps);
    expect(created.map((c) => c.title)).toEqual(['[F-01] ログイン', '[F-02] 一覧表示']);
  });

  it('does not file a second [SPEC] task while one is open', async () => {
    const { deps, created } = makeDeps({
      docs: { '/proj': DOC_WITHOUT_REACHABILITY },
      existing: { 1: [`${SPEC_GATE_TASK_PREFIX} 既存の要件修正タスク`] },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('still holds the features back while that [SPEC] task is open', async () => {
    // The dedupe must not become a way past the gate on the second run: the
    // document is still the one the checker rejected.
    const { deps, created } = makeDeps({
      docs: { '/proj': DOC_WITHOUT_REACHABILITY },
      existing: { 1: [`${SPEC_GATE_TASK_PREFIX} 既存の要件修正タスク`] },
    });
    await runRequirementIntakeJob(deps);
    expect(created.some((c) => c.title.startsWith('[F-'))).toBe(false);
  });

  it('lets the environment-setup gate run first', async () => {
    // A project with no manifest needs its setup task whatever the document
    // says; stopping on the spec instead would hide the real first step.
    const { deps, created } = makeDeps({
      docs: { '/proj': DOC_WITHOUT_REACHABILITY },
      manifests: { '/proj': false },
      runtimeConfigs: { '/proj': false },
    });
    await runRequirementIntakeJob(deps);
    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith(SPEC_GATE_TASK_PREFIX)).toBe(false);
  });
});
