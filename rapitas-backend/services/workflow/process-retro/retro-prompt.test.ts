/**
 * retro-prompt ユニットテスト
 *
 * 証拠バンドルのMarkdown整形(formatEvidenceSummary / buildRetroPrompt)を検証する。
 * キュー待機(初回ディスパッチ前)の別掲・待機0時の出力形状の不変に加え、
 * 批評追随拒否(critic_follow)の内訳描画と反復causeヒントからの除外を保証する。
 */
import { describe, test, expect, mock } from 'bun:test';

const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

// NOTE: retro-prompt は isCriticFollowRejection を retro-evidence から import し、
// retro-evidence は config/database に依存するため、DB をモックして純関数テストに保つ。
mock.module('../../../config/database', () => ({
  prisma: { workflowTransition: { findMany: () => Promise.resolve([]) } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { RETRO_SYSTEM_PROMPT, buildRetroPrompt, formatEvidenceSummary } =
  await import('./retro-prompt');
import type { EvidenceBundle, RetroTransitionRow } from './retro-types';

const bundle = (over: Partial<EvidenceBundle> = {}): EvidenceBundle => ({
  taskId: 516,
  title: 'テストタスク',
  timeline: [],
  criticRebounds: 0,
  repairCount: 0,
  replanCount: 0,
  anomalyCount: 0,
  criticFollowRejections: 0,
  invariantCount: 0,
  criticReasons: [],
  phaseTimings: { draft: 7 * 60_000 },
  queueWaitMs: 0,
  queueWaitDetail: null,
  ...over,
});

let nextId = 1;
const row = (over: Partial<RetroTransitionRow> = {}): RetroTransitionRow => ({
  id: nextId++,
  fromStatus: 'draft',
  toStatus: 'draft',
  actor: 'system',
  cause: 'transition_rejected',
  phase: 'plan',
  metadata: '{}',
  invariantViolation: true,
  createdAt: new Date(0),
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

  test('criticFollowRejections>0 なら anomaly 行直後に内訳と自己修復注記を描画する', () => {
    const md = formatEvidenceSummary(bundle({ criticRebounds: 1, criticFollowRejections: 2 }));
    expect(md).toContain('- 批評追随拒否(critic_follow): 2回');
    expect(md).toContain('自己修復連鎖');
    // 描画位置: 異常系(anomaly)行の直後、不変条件違反行の前。
    const anomalyIdx = md.indexOf('- 異常系(anomaly)');
    const followIdx = md.indexOf('- 批評追随拒否(critic_follow)');
    const invariantIdx = md.indexOf('- 不変条件違反(invariantViolation)');
    expect(anomalyIdx).toBeGreaterThanOrEqual(0);
    expect(followIdx).toBeGreaterThan(anomalyIdx);
    expect(invariantIdx).toBeGreaterThan(followIdx);
  });

  test('criticFollowRejections=0 なら従来と一文字も違わない出力を返す(後方互換の固定)', () => {
    const md = formatEvidenceSummary(bundle());
    expect(md).toBe(
      [
        '## 対象タスク',
        '- ID: 516 / タイトル: テストタスク',
        '',
        '## cause別カウント',
        '- 批評差し戻し(critic): 0回',
        '- 修復系(repair): 0回',
        '- 再計画(replan): 0回',
        '- 異常系(anomaly): 0回',
        '- 不変条件違反(invariantViolation): 0行',
        '',
        '## 批評差し戻し理由(最大12件)',
        '- (差し戻し理由なし)',
        '',
        '## フェーズ別所要時間(状態滞在時間)',
        '- draft: 7.0分',
        '',
        '## 遷移タイムライン(全件)',
        '- (遷移履歴なし)',
      ].join('\n'),
    );
  });
});

describe('buildRetroPrompt / RETRO_SYSTEM_PROMPT', () => {
  test('システムプロンプトはキュー待機を phase_wallclock の根拠から除外する指示を含む', () => {
    expect(RETRO_SYSTEM_PROMPT).toContain('キュー待機');
    expect(RETRO_SYSTEM_PROMPT).toContain('phase_wallclock 異常の根拠に');
  });

  test('システムプロンプトは批評追随拒否を想定内の自己修復連鎖として扱う解釈ルールを含む', () => {
    expect(RETRO_SYSTEM_PROMPT).toContain('批評追随拒否');
    expect(RETRO_SYSTEM_PROMPT).toContain('自己修復連鎖');
  });

  test('ユーザーメッセージは証拠要約と系統性ヒントを含む', () => {
    const md = buildRetroPrompt(bundle({ queueWaitMs: 60_000 }));
    expect(md).toContain('## キュー待機(初回ディスパッチ前)');
    expect(md).toContain('## 系統性ヒント');
  });

  test('批評追随拒否は反復causeヒントに数えない(task#601 incident 相当)', () => {
    const criticFollowMeta = JSON.stringify({ criticBouncePhase: 'research' });
    const incident = bundle({
      criticRebounds: 1,
      criticFollowRejections: 2,
      timeline: [
        row({ cause: 'research_critic_failed', metadata: '{}', createdAt: new Date(0) }),
        row({ metadata: criticFollowMeta, createdAt: new Date(21_000) }),
        row({ metadata: criticFollowMeta, createdAt: new Date(24_000) }),
      ],
    });
    const md = buildRetroPrompt(incident);
    expect(md).toContain('- このタスクで2回以上反復したcauseはない。');
    expect(md).not.toContain('transition_rejected: 2回');
  });

  test('相関キー無しの transition_rejected 反復は従来通り反復ヒントに残る', () => {
    const legacy = bundle({
      anomalyCount: 2,
      timeline: [
        row({ metadata: '{}', createdAt: new Date(0) }),
        row({ metadata: '{}', createdAt: new Date(10_000) }),
      ],
    });
    const md = buildRetroPrompt(legacy);
    expect(md).toContain('- transition_rejected: 2回');
  });
});
