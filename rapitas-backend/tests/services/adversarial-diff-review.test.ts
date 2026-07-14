/**
 * adversarial-diff-review テスト
 *
 * 純粋関数 parseReviewVerdict / buildDiffReviewPrompt の検証。
 * verdict 抽出のロバスト性（コードフェンス・前置き混じり・壊れJSON）と、
 * プロンプトに差分・受入基準・計画が含まれること。
 */
import { describe, test, expect } from 'bun:test';
import {
  parseReviewVerdict,
  buildDiffReviewPrompt,
  aggregateJuryVerdicts,
  type JurorVerdict,
} from '../../services/agents/verification/adversarial-diff-review';

describe('parseReviewVerdict', () => {
  test('素のJSON pass を解釈する', () => {
    const r = parseReviewVerdict('{"verdict":"pass","severity":0,"reasons":[]}');
    expect(r.verdict).toBe('pass');
    expect(r.judged).toBe(true);
  });

  test('fail と reasons/severity を抽出する', () => {
    const r = parseReviewVerdict(
      '{"verdict":"fail","severity":85,"reasons":["受入基準2が未実装","null チェック漏れ"]}',
    );
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(85);
    expect(r.reasons).toEqual(['受入基準2が未実装', 'null チェック漏れ']);
  });

  test('前置き＋コードフェンスに包まれていても抽出する', () => {
    const text =
      '判定します。\n```json\n{"verdict":"fail","severity":70,"reasons":["x"]}\n```\n以上';
    const r = parseReviewVerdict(text);
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(70);
  });

  test('fail で severity 欠落なら既定80', () => {
    expect(parseReviewVerdict('{"verdict":"fail"}').severity).toBe(80);
  });

  test('壊れJSON / 非JSON は unknown（フェイルオープン）', () => {
    expect(parseReviewVerdict('全然JSONじゃない文章').verdict).toBe('unknown');
    expect(parseReviewVerdict('{"verdict":').verdict).toBe('unknown');
    expect(parseReviewVerdict('').verdict).toBe('unknown');
    expect(parseReviewVerdict(null).judged).toBe(false);
  });
});

describe('aggregateJuryVerdicts', () => {
  const juror = (
    provider: JurorVerdict['provider'],
    verdict: JurorVerdict['verdict'],
    severity = 0,
    reasons: string[] = [],
  ): JurorVerdict => ({ provider, verdict, severity, reasons });

  test('多数決: 2 pass / 1 fail → pass', () => {
    const r = aggregateJuryVerdicts([
      juror('claude', 'pass'),
      juror('gemini', 'pass'),
      juror('chatgpt', 'fail', 90, ['x']),
    ]);
    expect(r.verdict).toBe('pass');
    expect(r.judged).toBe(true);
  });

  test('多数決: 2 fail / 1 pass → fail、severityは失格者の最大、reasonsは和集合', () => {
    const r = aggregateJuryVerdicts([
      juror('claude', 'fail', 60, ['基準未達']),
      juror('gemini', 'fail', 85, ['nullチェック漏れ', '基準未達']),
      juror('chatgpt', 'pass'),
    ]);
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(85);
    expect(r.reasons).toEqual(['基準未達', 'nullチェック漏れ']);
  });

  test('同数 (1-1) は懐疑側に倒して fail', () => {
    const r = aggregateJuryVerdicts([
      juror('claude', 'fail', 50, ['懸念']),
      juror('gemini', 'pass'),
      juror('chatgpt', 'unknown'),
    ]);
    expect(r.verdict).toBe('fail');
  });

  test('判定者1人だけならその判定を採用', () => {
    const r = aggregateJuryVerdicts([
      juror('claude', 'unknown'),
      juror('gemini', 'pass'),
      juror('chatgpt', 'unknown'),
    ]);
    expect(r.verdict).toBe('pass');
  });

  test('全員 unknown → unknown（可用性は呼び出し側のリスクゲートが処理）', () => {
    const r = aggregateJuryVerdicts([juror('claude', 'unknown'), juror('gemini', 'unknown')]);
    expect(r.verdict).toBe('unknown');
    expect(r.judged).toBe(false);
  });
});

describe('buildDiffReviewPrompt', () => {
  test('差分・受入基準・計画・ルーブリック・JSON指示を含む', () => {
    const p = buildDiffReviewPrompt({
      taskTitle: 'T',
      planContent: '# 計画\n設計判断の根拠...',
      acceptanceCriteria: ['基準A', '基準B'],
      diffText: '--- a.ts\n+const x = 1;',
    });
    expect(p).toContain('T');
    expect(p).toContain('基準A');
    expect(p).toContain('基準B');
    expect(p).toContain('設計判断の根拠');
    expect(p).toContain('const x = 1;');
    expect(p).toContain('verdict');
    expect(p).toContain('ルーブリック');
  });

  test('受入基準が無い場合のフォールバック文言', () => {
    const p = buildDiffReviewPrompt({
      taskTitle: 'T',
      planContent: '',
      acceptanceCriteria: [],
      diffText: 'x',
    });
    expect(p).toContain('明示的な受入基準なし');
  });
});

describe('buildJuryDiffText', () => {
  const file = (
    filename: string,
    patchLen: number,
    additions = 10,
  ): {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  } => ({
    filename,
    status: 'modified',
    additions,
    deletions: 2,
    patch: 'x'.repeat(patchLen),
  });

  test('小さい差分は省略なし（バナーもマーカーも出ない）', async () => {
    const { buildJuryDiffText } =
      await import('../../services/agents/verification/adversarial-diff-review');
    const text = buildJuryDiffText([file('a.ts', 100), file('b.ts', 100)]);
    expect(text).toContain('a.ts');
    expect(text).toContain('b.ts');
    expect(text).not.toContain('[省略');
    expect(text).not.toContain('⚠️');
  });

  test('上限超過でも全ファイルがマニフェストと本文ヘッダに現れること (task 485 回帰)', async () => {
    const { buildJuryDiffText } =
      await import('../../services/agents/verification/adversarial-diff-review');
    // 5ファイル × 大きなpatch。旧実装 (join後slice) では末尾ファイルが完全消失した。
    const files = [
      file('a.ts', 9000),
      file('b.ts', 9000),
      file('c.ts', 9000),
      file('d.ts', 9000),
      file('topic_editor_sheet.dart', 9000),
    ];
    const text = buildJuryDiffText(files, 10000);
    for (const f of files) {
      expect(text).toContain(`- ${f.filename} (modified, +10/-2)`); // マニフェスト
      expect(text).toContain(`--- ${f.filename}`); // 本文ヘッダ
    }
    expect(text).toContain('[省略');
    expect(text).toContain('未実装」と判定しない');
  });

  test('空配列は空文字を返す', async () => {
    const { buildJuryDiffText } =
      await import('../../services/agents/verification/adversarial-diff-review');
    expect(buildJuryDiffText([])).toBe('');
  });
});
