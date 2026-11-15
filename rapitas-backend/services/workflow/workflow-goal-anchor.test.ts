/**
 * workflow-goal-anchor.test
 *
 * The implementer re-reads the goal anchor before each change. 範囲外 and
 * 成果物 (#1555) belong there: what not to touch is what keeps a change from
 * widening, and the deliverable says what finishing hands over — for a
 * report, that "nothing to change" is a valid ending.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let row: Record<string, unknown> | null = null;
// When set, rows by id (subtask tests); otherwise every lookup returns `row`.
let rows: Record<number, Record<string, unknown>> | null = null;
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async (a: { where: { id: number } }) => (rows ? rows[a.where.id] : row),
    },
  },
}));

const { buildGoalAnchor } = await import('./workflow-goal-anchor');

beforeEach(() => {
  rows = null;
  row = {
    goals: '["ログから理由が読める"]',
    acceptanceCriteria: '["dev-pull.test.cjs に足したテストが通る"]',
    outOfScope: null,
    deliverable: null,
  };
});

describe('the goal anchor', () => {
  it('lists what is out of scope', async () => {
    row!.outOfScope = '["画面の再起動ボタン"]';
    const anchor = await buildGoalAnchor(1, { title: 'ログに理由を残す' }, 'ja');
    expect(anchor).toContain('範囲外');
    expect(anchor).toContain('画面の再起動ボタン');
  });

  it('says a report may end with nothing to change', async () => {
    row!.deliverable = 'report';
    const anchor = await buildGoalAnchor(1, { title: '監査する' }, 'ja');
    expect(anchor).toContain('成果物: 報告');
    expect(anchor).toContain('修正不要');
  });

  it('reads a missing deliverable as a PR', async () => {
    const anchor = await buildGoalAnchor(1, { title: 'ログに理由を残す' }, 'ja');
    expect(anchor).toContain('成果物: PR');
  });
});

describe('a subtask’s anchor (#1559)', () => {
  it('carries the parent’s goals, scope and deliverable when it has none', async () => {
    const parent = {
      goals: '["親のゴール"]',
      acceptanceCriteria: '["親の完了条件"]',
      outOfScope: '["親の範囲外"]',
      deliverable: 'report',
    };
    const child = { parentId: 1, goals: null, acceptanceCriteria: null, outOfScope: null };
    rows = { 2: child, 1: parent };
    const anchor = await buildGoalAnchor(2, { title: '手順1' }, 'ja');
    expect(anchor).toContain('親のゴール');
    expect(anchor).toContain('親の範囲外');
    expect(anchor).toContain('成果物: 報告');
  });
});

describe('start conditions in the anchor (#1559)', () => {
  it('lists them, and says to report one that does not hold', async () => {
    row!.startConditions = '["#12 の API が使える"]';
    const anchor = await buildGoalAnchor(1, { title: '画面を作る' }, 'ja');
    expect(anchor).toContain('開始条件');
    expect(anchor).toContain('#12 の API が使える');
  });
});

describe('a decision', () => {
  it('says to write the no-change heading, or the completion check stops it', async () => {
    row!.deliverable = 'decision';
    const anchor = await buildGoalAnchor(1, { title: '方式を決める' }, 'ja');
    expect(anchor).toContain('## 結論: 修正不要');
  });
});
