/**
 * extractMarkdownFromOutput / looksLikeAgentLog テスト
 *
 * mdファイルはエージェント実行の要。実行ログ（[Tool:]、spinner、ANSI、ログ行、
 * スタックトレース、"Uncaught ReferenceError…"）が混入しないこと、レポート見出しから
 * 切り出すこと、ログのみの出力は null（=ファイルを書かない）になることを検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  extractMarkdownFromOutput,
  looksLikeAgentLog,
  sliceFromReportHeading,
} from '../../services/workflow/workflow-file-utils';

const RESEARCH = `# 調査レポート

## タスク概要
対象のバグを調査した。

## 既存機能
- A が B を呼ぶ
- C は D に依存

## 影響範囲
限定的。

## 実装方針
1. 修正する
2. テストする

## リスク
低い。

## テスト戦略
ユニットテストを追加する。`;

describe('extractMarkdownFromOutput', () => {
  test('クリーンな調査レポートはそのまま通る', () => {
    const out = extractMarkdownFromOutput(RESEARCH, 'research');
    expect(out).not.toBeNull();
    expect(out!.startsWith('# 調査レポート')).toBe(true);
    expect(out).toContain('テスト戦略');
  });

  test('レポート前のログ前置きは見出しから切り出して除去する', () => {
    const noisy = `[2026-06-12 10:00:00] INFO (agent): starting
⏺ thinking...
[Tool: read_file] foo.ts
some intermediate narration\n${RESEARCH}`;
    const out = extractMarkdownFromOutput(noisy, 'research');
    expect(out).not.toBeNull();
    expect(out!.startsWith('# 調査レポート')).toBe(true);
    expect(out).not.toContain('[Tool: read_file]');
    expect(out).not.toContain('starting');
  });

  test('クラッシュ・ログのみ（レポート無し）は null を返す（=ファイルを書かない）', () => {
    const crash = `[2026-06-12 10:00:00] ERROR (agent): Uncaught ReferenceError: Workflow is not defined
    at runWorkflow (/app/workflow.ts:42:13)
    at async main (/app/index.ts:10:5)
Uncaught ReferenceError: Workflow is not defined
node:internal/process/task_queues:95`;
    expect(extractMarkdownFromOutput(crash, 'research')).toBeNull();
  });

  test('ANSI エスケープを除去する', () => {
    const ansi = `\x1b[32m# 検証レポート\x1b[0m\n\n## 検証結果サマリ\n\x1b[31m✅ 検証成功\x1b[0m\n- 全テスト通過\n- lint クリーン\n- 型チェック OK`;
    const out = extractMarkdownFromOutput(ansi, 'verify');
    expect(out).not.toBeNull();
    expect(out).not.toContain('\x1b[');
    expect(out).toContain('# 検証レポート');
  });

  test('スタックトレース行を本文から除去する', () => {
    const withTrace = `# 実装計画

## 概要
計画です。

    at Object.<anonymous> (/app/x.ts:1:1)
- ステップ1
- ステップ2
- ステップ3`;
    const out = extractMarkdownFromOutput(withTrace, 'plan');
    expect(out).not.toBeNull();
    expect(out).not.toContain('at Object.<anonymous>');
    expect(out).toContain('ステップ1');
  });

  test('構造の無い短い出力は null', () => {
    expect(extractMarkdownFromOutput('調査専用モードとして進めます。', 'research')).toBeNull();
    expect(extractMarkdownFromOutput('', 'research')).toBeNull();
  });

  test('会話的前置き＋非正規見出しでも前置きを除去する', () => {
    // 研究者が canonical な「# 調査レポート」ではなく「# 調査結果」で書き、
    // さらに会話的前置きを付けたケース（ユーザー報告のシナリオ）。
    const body = `# 調査結果

## タスク概要
対象を調査した。

## 影響範囲
限定的。

## テスト戦略
ユニットテストを追加する。`;
    const chatty = `これで必要な調査が完了しました。以下がresearch.mdです。\n\n${body}`;
    const out = extractMarkdownFromOutput(chatty, 'research');
    expect(out).not.toBeNull();
    expect(out!.startsWith('# 調査結果')).toBe(true);
    expect(out).not.toContain('以下がresearch.mdです');
  });
});

describe('sliceFromReportHeading', () => {
  test('canonical 見出しがあればそこから切り出す', () => {
    expect(sliceFromReportHeading(`前置き\n\n${RESEARCH}`, 'research')).toBe(RESEARCH);
  });

  test('canonical が無ければ最初の Markdown 見出しから切り出す', () => {
    const body = '# 調査結果\n\n## 概要\n本文。';
    expect(sliceFromReportHeading(`雑談。以下がファイルです。\n\n${body}`, 'research')).toBe(body);
  });

  test('見出しが無ければそのまま返す', () => {
    expect(sliceFromReportHeading('見出しの無いただの文。', 'research')).toBe(
      '見出しの無いただの文。',
    );
  });
});

describe('looksLikeAgentLog', () => {
  test('ログダンプを検出する', () => {
    const log = `ERROR: boom
    at f (/a.ts:1:1)
    at g (/b.ts:2:2)
Uncaught TypeError: x`;
    expect(looksLikeAgentLog(log)).toBe(true);
  });

  test('通常のレポート本文は false', () => {
    expect(looksLikeAgentLog(RESEARCH)).toBe(false);
  });
});
