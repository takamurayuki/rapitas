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

  test('[#{id}] 形式からタスクIDを抽出すること', () => {
    expect(extractTaskMarkerId('[#233] fix the button')).toBe(233);
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
    expect(titleMarkersAgree('[Task-172] t', '[#172] agent-made PR')).toBe(true);
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
      { linkedTaskId: null, title: 'feat: something', body: 'Auto PR for [#538]' },
      541,
    );
    expect(v.canClaim).toBe(false);
    expect(v.reason).toBe('body_marker_mismatch');
  });
});
