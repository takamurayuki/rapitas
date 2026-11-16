/**
 * criteria-autofix.test
 *
 * The first layer of the check before a task starts (#1561): the writing
 * mistakes with a record of failed runs behind them are rewritten into a
 * fixed form, without a person, before any tokens are spent.
 */
import { describe, it, expect } from 'bun:test';
import { autoFixCriteria, HANDOFF_CRITERION, UNCHANGED_ROUTE_CRITERION } from './criteria-autofix';

const spec = (acceptanceCriteria: string[], title = 'ログに理由を残す') => ({
  title,
  description: null,
  acceptanceCriteria,
});

describe('a criterion the agent cannot reach (#1280, #1283)', () => {
  it('is moved to the handoff, and replaced by writing the handoff in verify.md', () => {
    const out = autoFixCriteria(spec(['dev-pull.test.cjs が通る', 'CI がすべて緑になる']));
    expect(out.acceptanceCriteria).toEqual(['dev-pull.test.cjs が通る', HANDOFF_CRITERION]);
    expect(out.handoffs).toEqual(['CI がすべて緑になる']);
    expect(out.changes.map((c) => c.rule)).toEqual(['unreachable']);
  });

  it('adds the handoff criterion once however many are moved', () => {
    const out = autoFixCriteria(spec(['CI が通る', 'マージ後に本番で動く']));
    expect(out.acceptanceCriteria).toEqual([HANDOFF_CRITERION]);
    expect(out.handoffs).toHaveLength(2);
  });
});

describe('a criterion that asks a whole suite to pass (#1498)', () => {
  it('is rewritten to compare with the state before the change', () => {
    const out = autoFixCriteria(spec(['`node --test dev-pull.test.cjs` がすべて成功する']));
    expect(out.acceptanceCriteria[0]).toContain('変更前に通っていたテストが変更後もすべて通り');
    expect(out.changes[0]).toMatchObject({ rule: 'whole_suite' });
  });
});

describe('a report with no "nothing to change" ending (#1244)', () => {
  it('gets one', () => {
    const out = autoFixCriteria(spec(['結果を表にまとめる'], 'ログイン処理を監査する'));
    expect(out.acceptanceCriteria).toEqual(['結果を表にまとめる', UNCHANGED_ROUTE_CRITERION]);
    expect(out.changes.map((c) => c.rule)).toEqual(['no_unchanged_route']);
  });
});

describe('what is left alone', () => {
  it('changes nothing in a sound spec', () => {
    const out = autoFixCriteria(
      spec(['GET /tasks?q=abc が該当タスクを返す（確認方法: tasks.test.ts）']),
    );
    expect(out.changes).toEqual([]);
    expect(out.handoffs).toEqual([]);
  });

  // Not yet backed by failed runs: left to the AI review (layer 2).
  it('does not rewrite a criterion only missing a check method, or a bare "does not"', () => {
    const out = autoFixCriteria(spec(['検索機能を実装する', 'エラーを表示しないこと']));
    expect(out.changes).toEqual([]);
  });

  it('is idempotent: a fixed spec has nothing more to fix', () => {
    const once = autoFixCriteria(
      spec(['CI が通る', '既存のテストが全件パスする'], '依存を監査する'),
    );
    const twice = autoFixCriteria({ ...spec(once.acceptanceCriteria, '依存を監査する') });
    expect(twice.changes).toEqual([]);
  });
});
