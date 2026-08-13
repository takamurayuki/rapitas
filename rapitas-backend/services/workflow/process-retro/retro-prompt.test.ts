/**
 * retro-prompt ユニットテスト
 *
 * 証拠バンドルのMarkdown整形(formatEvidenceSummary / buildRetroPrompt)を検証する。
 * 特にキュー待機(初回ディスパッチ前)の別掲と、待機0時の出力形状の不変を保証する。
 */
import { describe, test, expect } from 'bun:test';

import { RETRO_SYSTEM_PROMPT, buildRetroPrompt, formatEvidenceSummary } from './retro-prompt';
import type { EvidenceBundle } from './retro-types';

const bundle = (over: Partial<EvidenceBundle> = {}): EvidenceBundle => ({
  taskId: 516,
  title: 'テストタスク',
  timeline: [],
  criticRebounds: 0,
  repairCount: 0,
  replanCount: 0,
  anomalyCount: 0,
  invariantCount: 0,
  criticReasons: [],
  phaseTimings: { draft: 7 * 60_000 },
  queueWaitMs: 0,
  queueWaitDetail: null,
  ...over,
});

describe('formatEvidenceSummary', () => {
  test('queueWaitMs>0 ならキュー待機セクションを分単位で別掲する', () => {
    const md = formatEvidenceSummary(bundle({ queueWaitMs: 864_000_000 })); // 10日
    expect(md).toContain('## キュー待機(初回ディスパッチ前)');
    expect(md).toContain('14400.0分');
    // フェーズ所要時間には待機が混入しない(draft は実行分のみ)。
    expect(md).toContain('- draft: 7.0分');
  });

  test('queueWaitDetail があれば待機区間・待機中cause・解消トリガー・原因帰属を記録する', () => {
    const md = formatEvidenceSummary(
      bundle({
        queueWaitMs: 864_000_000,
        queueWaitDetail: {
          waitMs: 864_000_000,
          waitStartAt: '2026-08-02T02:36:18.760Z',
          dispatchAt: '2026-08-12T01:09:24.604Z',
          dispatchCause: 'intake_enriched',
          preDispatchCauses: { reconciler_requeue: 2 },
        },
      }),
    );
    // 受入基準: 初期トリガー遅延の原因が特定・記録されること。
    expect(md).toContain('2026-08-02T02:36:18.760Z → 2026-08-12T01:09:24.604Z');
    expect(md).toContain('reconciler_requeue ×2');
    expect(md).toContain('intake_enriched');
    // 調査で確定した原因帰属(実測102ms=スケジューラ遅延ではない)が明記される。
    expect(md).toContain('トリガー遅延ではない');
    expect(md).toContain('102ms');
  });

  test('queueWaitMs=0 ならキュー待機セクションを出力しない(既存形状の維持)', () => {
    const md = formatEvidenceSummary(bundle());
    expect(md).not.toContain('キュー待機');
    expect(md).toContain('## フェーズ別所要時間(状態滞在時間)');
  });
});

describe('buildRetroPrompt / RETRO_SYSTEM_PROMPT', () => {
  test('システムプロンプトはキュー待機を phase_wallclock の根拠から除外する指示を含む', () => {
    expect(RETRO_SYSTEM_PROMPT).toContain('キュー待機');
    expect(RETRO_SYSTEM_PROMPT).toContain('phase_wallclock 異常の根拠に');
  });

  test('ユーザーメッセージは証拠要約と系統性ヒントを含む', () => {
    const md = buildRetroPrompt(bundle({ queueWaitMs: 60_000 }));
    expect(md).toContain('## キュー待機(初回ディスパッチ前)');
    expect(md).toContain('## 系統性ヒント');
  });
});
