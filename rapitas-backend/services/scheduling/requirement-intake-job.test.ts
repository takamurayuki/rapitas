/**
 * requirement-intake-job.test
 *
 * Verifies the requirement_intake periodic job files only the `[F-NN]` features
 * that are not yet tasks, and skips themes without a readable requirements.md.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runRequirementIntakeJob,
  readRequirementsFile,
  MAX_FILES_PER_THEME_RUN,
  type RequirementIntakeDeps,
  type IntakeTheme,
} from './requirement-intake-job';

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
}) {
  const created: Array<{ title: string; themeId: number }> = [];
  const deps: RequirementIntakeDeps = {
    listThemes: async () => opts.themes,
    readRequirements: async (dir) => opts.docs?.[dir] ?? null,
    listExistingTitles: async (themeId) => opts.existing?.[themeId] ?? [],
    createTask: async (payload) => {
      if (opts.failTitles?.includes(payload.title)) throw new Error('boom');
      created.push({ title: payload.title, themeId: payload.themeId });
      return true;
    },
  };
  return { deps, created };
}

describe('runRequirementIntakeJob', () => {
  it('files nothing when every feature already has a task with the same title', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 1, workingDirectory: '/proj' }],
      docs: { '/proj': DOC },
      existing: { 1: ['[F-01] ログイン', '[F-02] 一覧表示'] },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('treats an existing task with the same [F-NN] prefix as filed even if the title changed', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 1, workingDirectory: '/proj' }],
      docs: { '/proj': DOC },
      existing: { 1: ['[F-01] 認証機能(改題)', '[F-02] 別名'] },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('files only the missing features', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 1, workingDirectory: '/proj' }],
      docs: { '/proj': DOC },
      existing: { 1: ['[F-01] ログイン'] },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(1);
    expect(created).toEqual([{ title: '[F-02] 一覧表示', themeId: 1 }]);
  });

  it('skips null workingDirectory and missing requirements.md without throwing', async () => {
    const { deps, created } = makeDeps({
      themes: [
        { id: 1, workingDirectory: null },
        { id: 2, workingDirectory: '/no-doc' },
        { id: 3, workingDirectory: '/proj' },
      ],
      docs: { '/proj': DOC },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(2);
    expect(created.every((c) => c.themeId === 3)).toBe(true);
  });

  it('keeps going after one createTask failure and counts only successes', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 1, workingDirectory: '/proj' }],
      docs: { '/proj': DOC },
      failTitles: ['[F-01] ログイン'],
    });
    expect(await runRequirementIntakeJob(deps)).toBe(1);
    expect(created.map((c) => c.title)).toEqual(['[F-02] 一覧表示']);
  });

  it('isolates a theme whose read throws', async () => {
    const { deps, created } = makeDeps({
      themes: [
        { id: 1, workingDirectory: '/bad' },
        { id: 2, workingDirectory: '/proj' },
      ],
      docs: { '/proj': DOC },
    });
    deps.readRequirements = async (dir) => {
      if (dir === '/bad') throw new Error('EACCES');
      return DOC;
    };
    expect(await runRequirementIntakeJob(deps)).toBe(2);
    expect(created.every((c) => c.themeId === 2)).toBe(true);
  });

  it('caps filings per theme per run', async () => {
    const many = Array.from({ length: MAX_FILES_PER_THEME_RUN + 5 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return `- [F-${n}] 機能${n}\n  出力: x`;
    });
    const { deps } = makeDeps({
      themes: [{ id: 1, workingDirectory: '/proj' }],
      docs: { '/proj': ['# 機能要件', ...many].join('\n') },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(MAX_FILES_PER_THEME_RUN);
  });

  it('carries acceptance criteria and out-of-scope constraints from the shared payload builder', async () => {
    const payloads: Array<{ acceptanceCriteria: string[]; constraints: string[] }> = [];
    const { deps } = makeDeps({
      themes: [{ id: 1, workingDirectory: '/proj' }],
      docs: { '/proj': DOC },
    });
    deps.createTask = async (p) => {
      payloads.push(p);
      return true;
    };
    await runRequirementIntakeJob(deps);
    expect(payloads[0].acceptanceCriteria[0]).toContain('Given 未ログイン');
    expect(payloads[0].constraints).toContain('スコープ外: 決済');
  });

  // The documents are written at scaffold time and never updated, so decisions
  // made during implementation live only in the code — measured 2026-10-11,
  // task 1185 settled TempoRaid's room-capacity semantics while
  // requirements.md still described only 「4人まで」.
  it('files a documentation follow-up when the document and the work disagree', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 7, workingDirectory: '/p' }],
      docs: { '/p': DOC },
      // Both features already filed, plus one the document no longer declares.
      existing: { 7: ['[F-01] ログイン', '[F-02] 一覧表示', '[F-09] 消えた機能'] },
    });
    const filed = await runRequirementIntakeJob(deps);
    expect(filed).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].title.startsWith('[DOC]')).toBe(true);
    expect(created[0].themeId).toBe(7);
  });

  it('does not file a second follow-up while one is open', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 7, workingDirectory: '/p' }],
      docs: { '/p': DOC },
      existing: {
        7: ['[F-01] ログイン', '[F-02] 一覧表示', '[F-09] 消えた機能', '[DOC] 既存の追随タスク'],
      },
    });
    expect(await runRequirementIntakeJob(deps)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('does not report the features it just filed as missing from the work', async () => {
    // Drift is judged against the titles that existed BEFORE this run, so a
    // first run on a fresh project files features only.
    const { deps, created } = makeDeps({
      themes: [{ id: 7, workingDirectory: '/p' }],
      docs: { '/p': DOC },
      existing: { 7: [] },
    });
    await runRequirementIntakeJob(deps);
    expect(created.map((c) => c.title)).toEqual(['[F-01] ログイン', '[F-02] 一覧表示']);
    expect(created.some((c) => c.title.startsWith('[DOC]'))).toBe(false);
  });

  it('a drift-filing failure does not lose the feature tasks', async () => {
    const { deps, created } = makeDeps({
      themes: [{ id: 7, workingDirectory: '/p' }],
      docs: { '/p': DOC },
      existing: { 7: ['[F-01] ログイン', '[F-02] 一覧表示', '[F-09] 消えた機能'] },
      failTitles: ['[DOC] requirements.md を実装の実態に合わせる'],
    });
    expect(await runRequirementIntakeJob(deps)).toBe(0);
    expect(created).toHaveLength(0);
  });
});

describe('readRequirementsFile', () => {
  it('returns null for a missing file and the content for an existing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-intake-'));
    try {
      expect(await readRequirementsFile(dir)).toBeNull();
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs', 'requirements.md'), DOC, 'utf8');
      expect(await readRequirementsFile(dir)).toBe(DOC);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
