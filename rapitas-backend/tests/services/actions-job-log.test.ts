/**
 * actions getWorkflowJobLog テスト
 *
 * `gh run view --log` 出力を、REST のステップ時刻情報を使って per-step セクションへ
 * 振り分ける処理を検証。gh の step 列は信頼できない（UNKNOWN STEP）ため、各行の
 * タイムスタンプと各ステップの startedAt で割り当てる。BOM 除去・タイムスタンプ
 * 除去・ステップ情報欠如/gh エラー時のフォールバックもカバー。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// runGhCommand is called twice: once for `api .../jobs/{id}` (step timings),
// once for `run view --log --job`. Route by args.
const stepsJson = JSON.stringify([
  { number: 1, name: 'Set up job', started_at: '2026-01-01T00:00:00Z' },
  { number: 2, name: 'Build', started_at: '2026-01-01T00:00:10Z' },
]);
let logOutput = '';
let apiThrows = false;
let logThrows = false;

const mockRunGhCommand = mock((args: string[]) => {
  if (args.includes('api')) {
    if (apiThrows) return Promise.reject(new Error('api failed'));
    return Promise.resolve(stepsJson);
  }
  if (logThrows) return Promise.reject(new Error('log expired'));
  return Promise.resolve(logOutput);
});
mock.module('../../services/github/gh-client', () => ({ runGhCommand: mockRunGhCommand }));

const { getWorkflowJobLog } = await import('../../services/github/actions');

// BOM (U+FEFF) prefixes gh's first content line; the parser must strip it.
const BOM = '﻿';

describe('getWorkflowJobLog', () => {
  beforeEach(() => {
    mockRunGhCommand.mockClear();
    apiThrows = false;
    logThrows = false;
    logOutput = '';
  });

  test('タイムスタンプで各行を正しいステップへ割り当てること', async () => {
    logOutput = [
      `job\tUNKNOWN STEP\t${BOM}2026-01-01T00:00:01.5000000Z setup line`,
      'job\tUNKNOWN STEP\t2026-01-01T00:00:05.0000000Z still setup',
      'job\tUNKNOWN STEP\t2026-01-01T00:00:12.0000000Z build line',
    ].join('\n');

    const sections = await getWorkflowJobLog('owner/repo', 42);

    expect(sections).toEqual([
      { number: 1, name: 'Set up job', log: 'setup line\nstill setup' },
      { number: 2, name: 'Build', log: 'build line' },
    ]);
  });

  test('ログのないステップは空セクションとして実行順で返すこと', async () => {
    logOutput = 'job\tUNKNOWN STEP\t2026-01-01T00:00:11.0000000Z only build';

    const sections = await getWorkflowJobLog('owner/repo', 42);

    expect(sections).toEqual([
      { number: 1, name: 'Set up job', log: '' },
      { number: 2, name: 'Build', log: 'only build' },
    ]);
  });

  test('ステップ情報が取得できない場合は単一セクションにまとめること', async () => {
    apiThrows = true;
    logOutput = 'job\tUNKNOWN STEP\t2026-01-01T00:00:01.0000000Z line a';

    const sections = await getWorkflowJobLog('owner/repo', 42);

    expect(sections).toHaveLength(1);
    expect(sections[0].number).toBe(0);
    expect(sections[0].log).toBe('line a');
  });

  test('gh のログ取得が失敗したらエラーセクションを返すこと', async () => {
    logThrows = true;

    const sections = await getWorkflowJobLog('owner/repo', 42);

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe('ログ取得エラー');
    expect(sections[0].log).toContain('log expired');
  });

  test('--job フラグでジョブIDを指定して gh を呼ぶこと', async () => {
    logOutput = '';
    await getWorkflowJobLog('owner/repo', 999);

    const logCall = mockRunGhCommand.mock.calls.find((c) => (c[0] as string[]).includes('--log'));
    expect(logCall).toBeDefined();
    const args = logCall?.[0] as string[];
    expect(args).toContain('--job');
    expect(args).toContain('999');
  });
});
