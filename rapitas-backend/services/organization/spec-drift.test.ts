/**
 * spec-drift.test
 *
 * The generated documents are written at scaffold time, committed, and never
 * updated. Decisions made during implementation therefore live only in the
 * code: measured 2026-10-11, task 1185 settled TempoRaid's room-capacity
 * semantics with an atomic Lua check while requirements.md still says only
 * 「4人まで」. These tests pin the drift that is decidable from the document plus
 * the theme's task titles.
 */

import { describe, expect, test } from 'bun:test';
import { detectSpecDrift, toDriftTaskPayload, DRIFT_TASK_PREFIX } from './spec-drift';
import { ASSUMPTIONS_SECTION } from './spec-consistency';

const REQUIREMENTS = `# 概要

テスト用。

# 機能要件

- [F-01] 音声読込
- [F-02] ルーム参加

# ${ASSUMPTIONS_SECTION}

| # | 前提/未決事項 | 現在の扱い | 決める人 | 期限 |
| --- | --- | --- | --- | --- |
| 1 | 同時接続数 | 1万人と仮定 | PO | 着手前 |

# スコープ外

- なし
`;

/** Requirements with the assumptions section emptied of rows. */
const NO_ASSUMPTIONS = REQUIREMENTS.replace('| 1 | 同時接続数 | 1万人と仮定 | PO | 着手前 |\n', '');

describe('detectSpecDrift', () => {
  test('reports nothing while features are still unfiled', () => {
    expect(detectSpecDrift({ requirements: REQUIREMENTS, existingTitles: [] })).toEqual([]);
    expect(
      detectSpecDrift({ requirements: REQUIREMENTS, existingTitles: ['[F-01] 音声読込'] }),
    ).toEqual([]);
  });

  test('flags a filed feature the document no longer declares', () => {
    const findings = detectSpecDrift({
      requirements: REQUIREMENTS,
      existingTitles: ['[F-01] 音声読込', '[F-09] 消えた機能'],
    });
    expect(findings.some((f) => f.code === 'undocumented_feature' && f.featureId === 'F-09')).toBe(
      true,
    );
  });

  test('flags unknowns still listed once every feature has been filed', () => {
    const findings = detectSpecDrift({
      requirements: REQUIREMENTS,
      existingTitles: ['[F-01] 音声読込', '[F-02] ルーム参加'],
    });
    const row = findings.find((f) => f.code === 'unsettled_assumptions_after_build');
    expect(row).toBeTruthy();
    expect(row?.message).toContain('1 件');
  });

  test('does not count the table header or separator as an unknown', () => {
    expect(
      detectSpecDrift({
        requirements: NO_ASSUMPTIONS,
        existingTitles: ['[F-01] x', '[F-02] y'],
      }),
    ).toEqual([]);
  });

  test('reads the feature id from a reworded task title', () => {
    // The filer's titles are `[F-NN] <name>`, and a planner may reword the name.
    const findings = detectSpecDrift({
      requirements: REQUIREMENTS,
      existingTitles: ['［F-01］ 全く違う名前', '[F-02]  別の名前'],
    });
    expect(findings.some((f) => f.code === 'unsettled_assumptions_after_build')).toBe(true);
    expect(findings.some((f) => f.code === 'undocumented_feature')).toBe(false);
  });

  test('says nothing about a document with no features', () => {
    expect(
      detectSpecDrift({ requirements: '# 概要\n\nまだ無い。\n', existingTitles: ['[F-01] x'] }),
    ).toEqual([]);
  });
});

describe('toDriftTaskPayload', () => {
  test('returns null when there is nothing to fix', () => {
    expect(toDriftTaskPayload([], { themeId: 35 })).toBeNull();
  });

  test('folds every finding into one task', () => {
    const findings = detectSpecDrift({
      requirements: REQUIREMENTS,
      existingTitles: ['[F-01] x', '[F-02] y', '[F-09] 消えた'],
    });
    expect(findings.length).toBeGreaterThan(1);
    const payload = toDriftTaskPayload(findings, { themeId: 35 });
    expect(payload?.themeId).toBe(35);
    expect(payload?.title.startsWith(DRIFT_TASK_PREFIX)).toBe(true);
    for (const f of findings) expect(payload?.description).toContain(f.message);
  });

  test('forbids changing the implementation, and says so in a constraint', () => {
    const payload = toDriftTaskPayload([{ code: 'x', message: 'm' }], { themeId: 1 });
    expect(payload?.constraints.join('\n')).toContain('実装を変更しない');
    // Renumbering would break the link to already-filed task titles.
    expect(payload?.constraints.join('\n')).toContain('振り直さない');
  });

  test('its criteria are decidable from the diff', () => {
    const payload = toDriftTaskPayload([{ code: 'x', message: 'm' }], { themeId: 1 });
    expect(payload?.acceptanceCriteria).toHaveLength(3);
    // The last one is what keeps this a documentation task.
    expect(payload?.acceptanceCriteria.at(-1)).toContain('docs/');
  });
});
