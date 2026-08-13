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
