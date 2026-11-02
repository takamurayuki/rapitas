/**
 * pr-ownership テスト
 *
 * ブランチ名一致で見つかった既存PRを自タスクのPRとして採用してよいかを判定する
 * 純粋関数群のユニットテスト。マーカー一致/不一致/linkedTaskId先客/マーカー無しを検証。
 */
import { describe, test, expect } from 'bun:test';
import { extractTaskMarkerId, titleMarkersAgree, verifyPrOwnership } from './pr-ownership';

describe('extractTaskMarkerId', () => {
  test('[Task-{id}] 形式からタスクIDを抽出すること', () => {
    expect(extractTaskMarkerId('[Task-541] auto-PRリンクに同一性検証を追加')).toBe(541);
  });

  test('[#{id}] はブランチがそのタスクのもの (t{id}-) のときだけタスクIDとして読むこと', () => {
    expect(extractTaskMarkerId('[#233] fix the button', 'feature/t233-update-task')).toBe(233);
    expect(extractTaskMarkerId('[#233] fix the button', 't233-fix')).toBe(233);
  });

  // #1215: humans and CLAUDE.md-following sessions title PRs `[#<issue>]`, and
  // issue numbers and task ids overlap (both 1200-1400), so a bare `[#N]` must
  // never bind a PR to task N.
  test('[#{id}] はブランチの裏付けが無ければタスクIDとして読まないこと (#1215)', () => {
    expect(extractTaskMarkerId('[#1213] Model selection metric')).toBeNull();
    expect(extractTaskMarkerId('[#1213] Model selection metric', 'feature/1213-metric')).toBeNull();
    expect(extractTaskMarkerId('[#1213] x', 'feature/t12130-other')).toBeNull();
    expect(extractTaskMarkerId('[#1213] x', 'feature/t1214-other')).toBeNull();
  });

  test('裏付けの無い [#N] は飛ばし、後続の [Task-N] を拾うこと', () => {
    expect(extractTaskMarkerId('[#1213] fix ([Task-5] follow-up)')).toBe(5);
  });

  test('[Task-{id}] はブランチに関係なくタスクIDとして読むこと', () => {
    expect(extractTaskMarkerId('[Task-541] x', 'feature/1213-unrelated')).toBe(541);
  });

  test('マーカーが無ければ null を返すこと', () => {
    expect(extractTaskMarkerId('feat: add feature without marker')).toBeNull();
    expect(extractTaskMarkerId('')).toBeNull();
    expect(extractTaskMarkerId(null)).toBeNull();
    expect(extractTaskMarkerId(undefined)).toBeNull();
  });

  test('本文中の最初のマーカーを拾うこと', () => {
    expect(extractTaskMarkerId('## Summary\n\nAuto-generated PR for [Task-99] work')).toBe(99);
  });
});

describe('titleMarkersAgree', () => {
  test('両タイトルのマーカーが同一タスクなら true', () => {
    expect(titleMarkersAgree('[Task-172] t', '[Task-172] older title')).toBe(true);
    expect(titleMarkersAgree('[Task-172] t', '[#172] agent-made PR', 'feature/t172-x')).toBe(true);
  });

  test('[#N] の候補はブランチの裏付けが無ければ一致とみなさないこと (#1215)', () => {
    expect(titleMarkersAgree('[Task-172] t', '[#172] issue PR')).toBe(false);
    expect(titleMarkersAgree('[Task-172] t', '[#172] issue PR', 'feature/172-x')).toBe(false);
  });

  test('マーカーが別タスクなら false', () => {
    expect(titleMarkersAgree('[Task-539] mine', '[Task-538] theirs')).toBe(false);
  });

  test('どちらかにマーカーが無ければ false（証明できないものは採用しない）', () => {
    expect(titleMarkersAgree('[Task-539] mine', 'manual PR without marker')).toBe(false);
    expect(titleMarkersAgree('no marker here', '[Task-538] theirs')).toBe(false);
    expect(titleMarkersAgree('no marker', 'also no marker')).toBe(false);
  });
});

describe('verifyPrOwnership', () => {
  test('タイトルマーカーが自タスクと一致 → canClaim:true', () => {
    const v = verifyPrOwnership({ linkedTaskId: null, title: '[Task-541] fix', body: null }, 541);
    expect(v.canClaim).toBe(true);
    expect(v.reason).toBe('title_marker_match');
  });

  test('タイトルマーカーが他タスク → canClaim:false', () => {
    const v = verifyPrOwnership({ linkedTaskId: null, title: '[Task-538] other', body: null }, 541);
    expect(v.canClaim).toBe(false);
    expect(v.reason).toBe('title_marker_mismatch');
  });

  test('linkedTaskId が他タスク（先客あり）→ タイトルが一致していても canClaim:false', () => {
    // NOTE: linkedTaskId はマーカーより優先。既に他タスクにリンク済みのPRは決して奪わない。
    const v = verifyPrOwnership({ linkedTaskId: 538, title: '[Task-541] mine?', body: null }, 541);
    expect(v.canClaim).toBe(false);
    expect(v.reason).toBe('linked_to_other_task');
  });

  test('linkedTaskId が自タスク → canClaim:true（再実行・ci_repair の正当な再利用）', () => {
    const v = verifyPrOwnership({ linkedTaskId: 541, title: 'whatever', body: null }, 541);
    expect(v.canClaim).toBe(true);
    expect(v.reason).toBe('linked_to_self');
  });

  test('マーカー無しPR（linkedTaskIdも無し）→ canClaim:false（安全側）', () => {
    const v = verifyPrOwnership(
      { linkedTaskId: null, title: 'manual hotfix', body: 'no markers anywhere' },
      541,
    );
    expect(v.canClaim).toBe(false);
    expect(v.reason).toBe('no_marker');
  });

  test('本文マーカーのみで一致 → canClaim:true', () => {
    const v = verifyPrOwnership(
      { linkedTaskId: null, title: 'feat: something', body: 'Auto PR for [Task-541]' },
      541,
    );
    expect(v.canClaim).toBe(true);
    expect(v.reason).toBe('body_marker_match');
  });

  test('本文マーカーが他タスク → canClaim:false', () => {
    const v = verifyPrOwnership(
      { linkedTaskId: null, title: 'feat: something', body: 'Auto PR for [Task-538]' },
      541,
    );
    expect(v.canClaim).toBe(false);
    expect(v.reason).toBe('body_marker_mismatch');
  });

  // #1215: PR #1214 was titled `[#1213] …` for issue 1213 while task 1213 was an
  // unrelated, finished task. Re-running task 1213 must not adopt it.
  test('issue 番号の [#N] タイトルは同番号のタスクに採用されないこと (#1215)', () => {
    const issuePr = { linkedTaskId: null, title: '[#1213] Model metric', body: null };
    expect(verifyPrOwnership(issuePr, 1213)).toEqual({ canClaim: false, reason: 'no_marker' });
    expect(
      verifyPrOwnership({ ...issuePr, headBranch: 'feature/1213-model-metric' }, 1213).canClaim,
    ).toBe(false);
  });

  test('タスクのブランチ (t{id}-) から出た [#N] は従来どおり採用されること', () => {
    const v = verifyPrOwnership(
      { linkedTaskId: null, title: '[#1160] fix', body: null, headBranch: 'feature/t1160-x' },
      1160,
    );
    expect(v).toEqual({ canClaim: true, reason: 'title_marker_match' });
  });
});
