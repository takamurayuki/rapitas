/**
 * requirements-task-payload.test
 *
 * Shapes a parsed `[F-NN]` feature into the task fields the workflow reads.
 * Two of those fields decide whether the resulting task can actually land, so
 * they are pinned here rather than left to the caller:
 *
 * - acceptanceCriteria must be judgeable from the DIFF alone. The adversarial
 *   diff-review judge never receives the task description (memory:
 *   adversarial-diff-review-gate), so a criterion phrased as a future
 *   behaviour or as prose about intent fails every round.
 * - constraints must carry the document's explicit non-goals, or an
 *   implementer is free to wander into them and the review has no basis to
 *   object.
 */
import { describe, expect, it } from 'bun:test';
import { toTaskPayload } from './requirements-task-payload';

const SPEC = {
  id: 'F-06',
  title: 'リズム攻撃判定',
  detail: [
    '- 入力: 入力イベント(songTimeMs, action)。',
    '  - 処理: 最寄りビートとの差でPERFECT(±40ms)/GOOD(±90ms)/MISSを判定する。',
    '  - 出力: 判定結果、ダメージ、コンボ。',
  ].join('\n'),
  acceptanceCriteria: ['Given ビートから±40ms When 攻撃 Then PERFECT。±90ms超ならMISS。'],
};
const OUT_OF_SCOPE = ['モバイル/ネイティブアプリ', '音声チャット、課金'];

describe('toTaskPayload', () => {
  it('names the task with its feature id so the backlog stays traceable', () => {
    const p = toTaskPayload(SPEC, { themeId: 35, outOfScope: OUT_OF_SCOPE });
    expect(p.title).toBe('[F-06] リズム攻撃判定');
    expect(p.themeId).toBe(35);
  });

  it('carries the feature body and says where it came from', () => {
    const p = toTaskPayload(SPEC, { themeId: 35, outOfScope: OUT_OF_SCOPE });
    expect(p.description).toContain('最寄りビートとの差でPERFECT');
    // Without the provenance line a reader cannot tell this was generated from
    // the spec rather than hand-written, nor find the source of truth.
    expect(p.description).toContain('requirements.md');
    expect(p.description).toContain('F-06');
  });

  it('passes the acceptance criterion through verbatim', () => {
    const p = toTaskPayload(SPEC, { themeId: 35, outOfScope: OUT_OF_SCOPE });
    expect(p.acceptanceCriteria).toContain(SPEC.acceptanceCriteria[0]);
  });

  it('adds a diff-judgeable criterion when the document gives none', () => {
    // An empty criteria list makes the completion gate unmeasurable, and the
    // judge cannot read the description to infer one.
    const p = toTaskPayload({ ...SPEC, acceptanceCriteria: [] }, { themeId: 35, outOfScope: [] });
    expect(p.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(p.acceptanceCriteria.join(' ')).toContain('F-06');
  });

  it('turns the non-goals into constraints', () => {
    const p = toTaskPayload(SPEC, { themeId: 35, outOfScope: OUT_OF_SCOPE });
    expect(p.constraints.join(' ')).toContain('モバイル/ネイティブアプリ');
    expect(p.constraints.join(' ')).toContain('音声チャット、課金');
  });

  it('always constrains the work to the feature itself', () => {
    // Twelve features filed at once would otherwise invite one task to
    // implement its neighbours and leave the rest with nothing to do.
    const p = toTaskPayload(SPEC, { themeId: 35, outOfScope: [] });
    expect(p.constraints.join(' ')).toContain('F-06');
  });

  it('requires tests, since a generated project starts with none', () => {
    const p = toTaskPayload(SPEC, { themeId: 35, outOfScope: [] });
    expect(p.goals.join(' ') + p.constraints.join(' ')).toMatch(/テスト/);
  });
});
