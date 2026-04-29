/**
 * Agent Response Cleaner テスト
 * エージェント出力のクリーンアップ処理のテスト
 */
import { describe, test, expect } from 'bun:test';
import { cleanImplementationSummary } from '../../utils/agent/agent-response-cleaner';

describe('cleanImplementationSummary', () => {
  test('空入力でデフォルトメッセージを返すこと', () => {
    expect(cleanImplementationSummary('')).toBe('Implementation completed.');
    expect(cleanImplementationSummary('   ')).toBe('Implementation completed.');
  });

  test('null/undefinedでデフォルトメッセージを返すこと', () => {
    expect(cleanImplementationSummary(null as unknown as string)).toBe('Implementation completed.');
    expect(cleanImplementationSummary(undefined as unknown as string)).toBe(
      'Implementation completed.',
    );
  });

  test('正常なMarkdownテキストをそのまま保持すること', () => {
    const input = '# 変更内容\n\n- 機能Aを追加\n- 機能Bを修正';
    const result = cleanImplementationSummary(input);
    expect(result).toContain('# 変更内容');
    expect(result).toContain('機能Aを追加');
    expect(result).toContain('機能Bを修正');
  });

  test('ログ出力行を除去すること', () => {
    const input = '[実行開始] Starting...\n# Summary\n[DEBUG] debug info\n実装が完了しました';
    const result = cleanImplementationSummary(input);
    expect(result).not.toContain('[実行開始]');
    expect(result).not.toContain('[DEBUG]');
    expect(result).toContain('# Summary');
    expect(result).toContain('実装が完了しました');
  });

  test('タイムスタンプ付きログを除去すること', () => {
    const input = '[2026-03-04T10:00:00.000Z] Log entry\nActual content here';
    const result = cleanImplementationSummary(input);
    expect(result).not.toContain('2026-03-04');
    expect(result).toContain('Actual content here');
  });

  test('コマンド実行行を除去すること', () => {
    const input = '> npm install\n$ bun test\nTests passed successfully';
    const result = cleanImplementationSummary(input);
    expect(result).not.toContain('> npm install');
    expect(result).not.toContain('$ bun test');
    expect(result).toContain('Tests passed successfully');
  });

  test('npm/bun等のコマンド行を除去すること', () => {
    const input = 'npm run build\nbun test --watch\nBuild completed';
    const result = cleanImplementationSummary(input);
    expect(result).not.toContain('npm run build');
    expect(result).not.toContain('bun test');
    expect(result).toContain('Build completed');
  });

  test('スタックトレースを除去すること', () => {
    const input = 'Error occurred\nat Object.test (file.ts:10)\nPlease fix this';
    const result = cleanImplementationSummary(input);
    expect(result).not.toContain('at Object.test');
    expect(result).toContain('Please fix this');
  });

  test('重複コンテンツを除去すること', () => {
    const input = 'Line one\nLine one\nLine two\n  line one  ';
    const result = cleanImplementationSummary(input);
    const lines = result.split('\n').filter((l) => l.trim());
    // Duplicates are removed, so only unique lines remain
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  test('区切り線を除去すること', () => {
    const input = 'Content above\n---\nContent below\n===';
    const result = cleanImplementationSummary(input);
    expect(result).not.toMatch(/^[\-=]{3,}$/m);
    expect(result).toContain('Content above');
    expect(result).toContain('Content below');
  });

  test('2000文字を超える場合に切り詰めること', () => {
    const longContent = Array(100).fill('This is a paragraph of content.\n\n').join('');
    const result = cleanImplementationSummary(longContent);
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  test('全行がフィルタされた場合に元テキストの先頭を使用すること', () => {
    const input = '[DEBUG] line1\n[INFO] line2\n[ERROR] line3';
    const result = cleanImplementationSummary(input);
    // All lines are filtered, so the beginning of the original text is used
    expect(result.length).toBeGreaterThan(0);
  });
});
