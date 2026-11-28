/**
 * criteria-autofix.reachable.test
 *
 * 2026-11-28: the auto-fix moved the core criteria of 1599 and 1600 to the
 * handoff ("unreachable") because they mention CI, push or merge — although
 * each one said it is checked by a test. 1599 was left with no criterion about
 * what it was meant to fix. A criterion that names a test as its check is
 * reachable, whatever behaviour it describes.
 *
 * The same day showed that the whole-suite rewrite itself asked for every test
 * that passed before to pass after, which a verifier read as "run the whole
 * suite" (1542). The rewrite now names the narrow scope.
 */
import { describe, expect, it } from 'bun:test';
import { autoFixCriteria } from './criteria-autofix';

const spec = (acceptanceCriteria: string[]) => ({
  title: 'CI の修正の流れを直す',
  description: null,
  acceptanceCriteria,
});

describe('a criterion checked by a test is kept, even when it mentions CI or merge', () => {
  it.each([
    'CI の修正の push のあと、タスクが PR のマージ待ちに戻り、CI が緑になると自動マージの見張りがマージして完了にすることをテストで示す',
    '保留で空いた枠に、作業の列で待っている CI の修正の項目が先に入ることをテストで示す',
    'CI の修正の回で、修正が PR のブランチに push されることを、git の操作を差し替えたテストで確かめる',
  ])('%s', (criterion) => {
    const out = autoFixCriteria(spec([criterion]));
    expect(out.acceptanceCriteria).toContain(criterion);
    expect(out.handoffs).toEqual([]);
    expect(out.changes.filter((c) => c.rule === 'unreachable')).toEqual([]);
  });

  it('a criterion that needs a real CI run, with no test named, is still moved', () => {
    const out = autoFixCriteria(spec(['CI がすべて緑になる']));
    expect(out.handoffs).toEqual(['CI がすべて緑になる']);
  });
});

describe('the whole-suite rewrite names the narrow scope', () => {
  it('asks for the changed files and their direct importers, run once before the change', () => {
    const out = autoFixCriteria(spec(['`bun test` がすべて成功する']));
    const after = out.acceptanceCriteria[0];
    expect(after).toContain('変更したファイルを直接 import しているテスト');
    expect(after).toContain('ディレクトリ全体やスイート全体は実行しない');
    expect(after).not.toContain('変更前に通っていたテストが変更後もすべて通り');
  });
});
