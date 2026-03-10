import { type ScreenshotResult } from '../services/screenshot-service';

/**
 * スクリーンショット結果からフロントエンド表示に不要な path（ファイルシステムパス）を除外する
 */
export function sanitizeScreenshots(screenshots: ScreenshotResult[]) {
  return screenshots.map(({ path, ...rest }) => rest);
}

/**
 * エージェント出力からクリーンな実装サマリーを抽出する。
 * ログ出力やデバッグ情報、重複する説明を除去し、ユーザーが分かりやすい簡潔な説明にまとめる。
 */
export function cleanImplementationSummary(rawOutput: string): string {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return '実装が完了しました。';
  }

  const lines = rawOutput.split('\n');
  const cleanedLines: string[] = [];
  const seenContent = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行はスキップ（後で必要に応じて追加）
    if (trimmed === '') continue;

    // ログ出力パターンを除外
    if (/^\[(?:実行開始|実行中|API|DEBUG|INFO|WARN|ERROR|LOG)\]/.test(trimmed)) continue;
    if (/^\[[\d\-T:.Z]+\]/.test(trimmed)) continue; // タイムスタンプ付きログ
    if (/^(?:>|>>|\$)\s/.test(trimmed)) continue; // コマンド実行行
    if (/^(?:npm|bun|yarn|pnpm)\s(?:run|install|build|test|exec)/.test(trimmed)) continue;
    if (/^(?:Running|Executing|Starting|Compiling|Building|Installing)[\s:]/.test(trimmed))
      continue;
    if (/^(?:stdout|stderr|exit code|pid|process)[\s:]/i.test(trimmed)) continue;
    if (/^(?:✓|✗|✔|✘|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(trimmed)) continue; // スピナー・チェックマーク
    if (/^(?:warning|error|info|debug|trace|verbose)\s*:/i.test(trimmed)) continue;
    if (/^(?:at\s+|Error:|TypeError:|ReferenceError:|SyntaxError:)/.test(trimmed)) continue; // スタックトレース
    if (/^(?:\d+\s+(?:passing|failing|pending))/.test(trimmed)) continue; // テスト結果の詳細行
    if (/console\.(?:log|error|warn|info|debug)\s*\(/.test(trimmed)) continue; // console.log呼び出し
    if (/^[\-=]{3,}$/.test(trimmed)) continue; // 区切り線
    if (/^#{4,}\s/.test(trimmed)) continue; // 深すぎる見出し（h4以下）は除外

    // 重複コンテンツを除去（正規化して比較）
    const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase();
    if (seenContent.has(normalized)) continue;
    seenContent.add(normalized);

    cleanedLines.push(line);
  }

  let result = cleanedLines.join('\n').trim();

  // 結果が空なら元のテキストの先頭部分を使用
  if (result.length === 0) {
    result = rawOutput.trim().substring(0, 500);
  }

  // 長すぎる場合は切り詰める（マークダウンの構造を壊さないように段落単位で）
  if (result.length > 2000) {
    const paragraphs = result.split(/\n\n+/);
    let truncated = '';
    for (const paragraph of paragraphs) {
      if (truncated.length + paragraph.length > 1800) break;
      truncated += (truncated ? '\n\n' : '') + paragraph;
    }
    result = truncated || result.substring(0, 1800);
  }

  return result;
}
