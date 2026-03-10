/**
 * Mojibake Detection and Fix Utility
 * AIエージェントのMD出力で発生しがちな文字化けを検出・修正する
 */

export interface MojibakeDetectionResult {
  hasMojibake: boolean;
  score: number; // 0-100の文字化け度スコア
  issues: string[];
  patterns: {
    utf8ToLatin1: string[];
    replacementChars: number;
    controlChars: number;
    invalidSequences: string[];
  };
}

export interface SanitizeResult {
  content: string;
  wasFixed: boolean;
  issues: string[];
  originalLength: number;
  fixedLength: number;
}

/**
 * UTF-8からLatin-1への誤解釈でよく出現する文字化けパターン
 * 日本語の「こんにちは」→ UTF-8バイト→ Latin-1解釈で起こる典型例
 */
const UTF8_LATIN1_PATTERNS = [
  // 「あ」(U+3042) → UTF-8(E3 81 82) → Latin-1(ã)
  /ã[\x80-\xBF]{2}/g,
  // 頻出パターン
  /Ã£Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã¢Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã¤Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã¥Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã§Â[\x80-\xBF][\x80-\xBF]/g,
  // より一般的なUTF-8 3バイト文字のLatin-1解釈
  /[\xC3][\x80-\xBF][\xC2][\x80-\xBF][\x80-\xBF]/g,
  // 2バイト文字パターン（ひらがな・カタカナ範囲）
  /[\xC3][\x81-\x82][\xC2][\x80-\xBF]/g,
];

/**
 * 文字化けを検出する
 */
export function detectMojibake(text: string): MojibakeDetectionResult {
  const issues: string[] = [];
  let score = 0;

  const patterns = {
    utf8ToLatin1: [] as string[],
    replacementChars: 0,
    controlChars: 0,
    invalidSequences: [] as string[],
  };

  // 1. UTF-8→Latin-1誤解釈パターンの検出
  for (const pattern of UTF8_LATIN1_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      patterns.utf8ToLatin1.push(...matches);
      score += matches.length * 15; // 1つ見つかるごとに15点加算
      issues.push(
        `UTF-8→Latin-1誤解釈パターンを${matches.length}箇所検出: ${matches.slice(0, 3).join(', ')}`,
      );
    }
  }

  // 2. 置換文字 (U+FFFD) の検出
  const replacementCharMatches = text.match(/\uFFFD/g);
  if (replacementCharMatches) {
    patterns.replacementChars = replacementCharMatches.length;
    score += patterns.replacementChars * 20;
    issues.push(`置換文字(�)を${patterns.replacementChars}箇所検出`);
  }

  // 3. 制御文字の検出（タブ・改行・復帰文字は除く）
  const controlCharMatches = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g);
  if (controlCharMatches) {
    patterns.controlChars = controlCharMatches.length;
    score += patterns.controlChars * 10;
    issues.push(`制御文字を${patterns.controlChars}箇所検出`);
  }

  // 4. 不正なUTF-8シーケンスの検出
  // サロゲートペア範囲の不正使用
  const surrogateMatches = text.match(/[\uD800-\uDFFF]/g);
  if (surrogateMatches) {
    patterns.invalidSequences.push(...surrogateMatches);
    score += surrogateMatches.length * 25;
    issues.push(`不正なサロゲートペア文字を${surrogateMatches.length}箇所検出`);
  }

  // 5. 日本語コンテキストでの異常パターン
  const japaneseTextRatio =
    (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length /
    Math.max(text.length, 1);
  if (japaneseTextRatio > 0.1) {
    // 日本語が10%以上含まれる場合
    // 日本語の後に意味不明なバイト列が続くパターン
    const brokenJapanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][\x80-\xFF]{2,}/g;
    const brokenMatches = text.match(brokenJapanesePattern);
    if (brokenMatches) {
      patterns.invalidSequences.push(...brokenMatches);
      score += brokenMatches.length * 15;
      issues.push(`日本語文字化けパターンを${brokenMatches.length}箇所検出`);
    }
  }

  // スコアの上限を100に制限
  score = Math.min(score, 100);

  return {
    hasMojibake: score > 20, // スコア20以上を文字化けとみなす
    score,
    issues,
    patterns,
  };
}

/**
 * UTF-8→Latin-1誤解釈を修復する
 */
function fixUtf8Latin1(text: string): string {
  let fixed = text;

  // 典型的なUTF-8 3バイト文字の修復を試行
  // ただし、確実に修復できるパターンのみに限定（データ破壊を避けるため）

  // パターン1: Ã£Â\x81\x82 → あ (U+3042)のような確実なパターンのみ
  const knownPatterns = [
    { broken: /Ã£Â\x81\x82/g, fixed: 'あ' },
    { broken: /Ã£Â\x81\x84/g, fixed: 'い' },
    { broken: /Ã£Â\x81\x86/g, fixed: 'う' },
    { broken: /Ã£Â\x81\x88/g, fixed: 'え' },
    { broken: /Ã£Â\x81\x8A/g, fixed: 'お' },
  ];

  for (const { broken, fixed: char } of knownPatterns) {
    fixed = fixed.replace(broken, char);
  }

  // より汎用的だが安全な修復: 明らかに文字化けしたバイト列を除去
  // （ただし、日本語コンテンツが含まれている場合のみ）
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(fixed);
  if (hasJapanese) {
    // 日本語文字の後に続く明らかに不正なバイト列を除去
    fixed = fixed.replace(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][\x80-\xFF]+/g, (match) => {
      return match.charAt(0); // 日本語文字のみ残し、後続のバイト列は除去
    });
  }

  return fixed;
}

/**
 * 文字化けを修正する
 */
export function fixMojibake(text: string): string {
  let fixed = text;

  // 1. 置換文字(U+FFFD)を除去
  fixed = fixed.replace(/\uFFFD/g, '');

  // 2. 制御文字を除去（タブ・改行・復帰文字は保持）
  fixed = fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. 不正なサロゲートペア文字を除去
  fixed = fixed.replace(/[\uD800-\uDFFF]/g, '');

  // 4. UTF-8→Latin-1誤解釈の修復
  fixed = fixUtf8Latin1(fixed);

  // 5. 連続する空白文字の正規化
  fixed = fixed.replace(/[ \t]+/g, ' ');

  // 6. 過剰な改行の正規化（3つ以上連続する改行を2つに制限）
  fixed = fixed.replace(/\n{3,}/g, '\n\n');

  return fixed.trim();
}

/**
 * Markdownコンテンツをサニタイズする（メイン関数）
 */
export function sanitizeMarkdownContent(text: string): SanitizeResult {
  const originalLength = text.length;
  const detection = detectMojibake(text);

  let content = text;
  let wasFixed = false;
  const issues: string[] = [];

  if (detection.hasMojibake) {
    const fixedText = fixMojibake(text);

    // 修正後に再検証
    const redetection = detectMojibake(fixedText);

    // 修正により文字化けスコアが改善された場合のみ採用
    if (redetection.score < detection.score) {
      content = fixedText;
      wasFixed = true;
      issues.push(`文字化けを修正しました (スコア: ${detection.score} → ${redetection.score})`);
      issues.push(...detection.issues);
    } else {
      // 修正が効果的でない場合は元のテキストを保持
      content = text;
      issues.push('文字化けを検出しましたが、修正により品質が向上しませんでした');
      issues.push(...detection.issues);
    }
  }

  return {
    content,
    wasFixed,
    issues,
    originalLength,
    fixedLength: content.length,
  };
}
