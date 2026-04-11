/**
 * Mojibake Detection and Fix Utility
 *
 * Detects and repairs mojibake (character corruption) commonly found
 * in AI agent markdown output.
 */

export interface MojibakeDetectionResult {
  hasMojibake: boolean;
  score: number; // Mojibake severity score (0-100)
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
 * Common mojibake patterns caused by UTF-8 to Latin-1 misinterpretation.
 * For example, Japanese characters get corrupted when UTF-8 bytes are decoded as Latin-1.
 */
const UTF8_LATIN1_PATTERNS = [
  // "a" (U+3042) -> UTF-8(E3 81 82) -> Latin-1(ã) misinterpretation
  /ã[\x80-\xBF]{2}/g,
  // Frequently occurring patterns
  /Ã£Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã¢Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã¤Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã¥Â[\x80-\xBF][\x80-\xBF]/g,
  /Ã§Â[\x80-\xBF][\x80-\xBF]/g,
  // More general UTF-8 3-byte character Latin-1 misinterpretation
  /[\xC3][\x80-\xBF][\xC2][\x80-\xBF][\x80-\xBF]/g,
  // 2-byte character patterns (hiragana/katakana range)
  /[\xC3][\x81-\x82][\xC2][\x80-\xBF]/g,
];

/**
 * Detect mojibake in the given text.
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

  // 1. Detect UTF-8 -> Latin-1 misinterpretation patterns
  for (const pattern of UTF8_LATIN1_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      patterns.utf8ToLatin1.push(...matches);
      score += matches.length * 15; // +15 points per occurrence
      issues.push(
        `${matches.length}個のUTF-8→Latin-1誤解釈パターンを検出: ${matches.slice(0, 3).join(', ')}`,
      );
    }
  }

  // 2. Detect replacement characters (U+FFFD)
  const replacementCharMatches = text.match(/\uFFFD/g);
  if (replacementCharMatches) {
    patterns.replacementChars = replacementCharMatches.length;
    score += patterns.replacementChars * 20;
    issues.push(`${patterns.replacementChars}個の置換文字(�)を検出`);
  }

  // 3. Detect control characters (excluding tab, newline, carriage return)
  const controlCharMatches = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g);
  if (controlCharMatches) {
    patterns.controlChars = controlCharMatches.length;
    score += patterns.controlChars * 10;
    issues.push(`${patterns.controlChars}個の制御文字を検出`);
  }

  // 4. Detect invalid UTF-8 sequences
  // Invalid use of surrogate pair range
  const surrogateMatches = text.match(/[\uD800-\uDFFF]/g);
  if (surrogateMatches) {
    patterns.invalidSequences.push(...surrogateMatches);
    score += surrogateMatches.length * 25;
    issues.push(`${surrogateMatches.length}個の不正サロゲートペア文字を検出`);
  }

  // 5. Double encoding detection (Windows-1252 → UTF-8)
  const doubleEncodingPatterns = [
    /â€œ/g, // "
    /â€\x9D/g, // "
    /â€˜/g, // '
    /â€™/g, // '
    /â€"/g, // —
    /â€"/g, // –
    /â€¦/g, // …
    /Ã¢â‚¬/g, // General Windows-1252 double encoding
  ];

  let doubleEncodingCount = 0;
  for (const pattern of doubleEncodingPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      doubleEncodingCount += matches.length;
      patterns.invalidSequences.push(...matches);
    }
  }

  if (doubleEncodingCount > 0) {
    score += doubleEncodingCount * 10;
    issues.push(`${doubleEncodingCount}個の二重エンコーディングパターンを検出`);
  }

  // 6. Anomalous patterns in Japanese context
  const japaneseTextRatio =
    (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length /
    Math.max(text.length, 1);
  if (japaneseTextRatio > 0.1) {
    // When text contains 10%+ Japanese characters
    // Pattern: Japanese character followed by meaningless byte sequences
    const brokenJapanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][\x80-\xFF]{2,}/g;
    const brokenMatches = text.match(brokenJapanesePattern);
    if (brokenMatches) {
      patterns.invalidSequences.push(...brokenMatches);
      score += brokenMatches.length * 15;
      issues.push(`${brokenMatches.length}個の日本語文字化けパターンを検出`);
    }
  }

  // Cap score at 100
  score = Math.min(score, 100);

  return {
    hasMojibake: score >= 20, // Score 20 or above is considered mojibake
    score,
    issues,
    patterns,
  };
}

/**
 * Repair UTF-8 -> Latin-1 misinterpretation using hybrid approach.
 */
function fixUtf8Latin1(text: string): string {
  let fixed = text;

  try {
    // 1. Known safe patterns (from original implementation)
    // These patterns are reliably reversible and tested
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

    // 2. Generic UTF-8 → Latin-1 recovery using Buffer (conservative approach)
    // Only try on sequences that don't match known patterns
    const remainingUtf8Sequences = /[\x80-\xFF]{2,4}/g;
    const matches = fixed.match(remainingUtf8Sequences);

    if (matches) {
      for (const sequence of matches) {
        // Skip if already processed by known patterns
        if (knownPatterns.some((pattern) => pattern.broken.test(sequence))) {
          continue;
        }

        try {
          // Try to interpret the Latin-1 sequence as UTF-8
          const latin1Buffer = Buffer.from(sequence, 'latin1');
          const utf8String = latin1Buffer.toString('utf8');

          // Only replace if the result looks like valid text (contains no replacement chars)
          // and produces sensible characters (printable, Japanese, etc.)
          if (
            !utf8String.includes('\uFFFD') &&
            utf8String.length > 0 &&
            /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u0020-\u007E]/.test(utf8String)
          ) {
            fixed = fixed.replace(sequence, utf8String);
          }
        } catch {
          // Ignore failed conversions
          continue;
        }
      }
    }

    // 3. Specific pattern fixes for common Windows-1252 → UTF-8 double encoding
    const windows1252Patterns = [
      // Curly quotes
      { broken: /â€œ/g, fixed: '"' }, // Left double quotation mark
      { broken: /â€\x9D/g, fixed: '"' }, // Right double quotation mark
      { broken: /â€˜/g, fixed: "'" }, // Left single quotation mark
      { broken: /â€™/g, fixed: "'" }, // Right single quotation mark
      // Em dash and en dash
      { broken: /â€"/g, fixed: '—' },
      { broken: /â€"/g, fixed: '–' },
      // Ellipsis
      { broken: /â€¦/g, fixed: '…' },
    ];

    for (const { broken, fixed: char } of windows1252Patterns) {
      fixed = fixed.replace(broken, char);
    }

    // 4. Japanese-specific cleanup (preserve from original implementation)
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(fixed);
    if (hasJapanese) {
      // Remove clearly invalid byte sequences following Japanese characters
      fixed = fixed.replace(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][\x80-\xFF]+/g, (match) => {
        return match.charAt(0); // Keep only the Japanese character, strip trailing bytes
      });
    }
  } catch {
    // If any error occurs during fixing, return original text
    return text;
  }

  return fixed;
}

/**
 * Fix mojibake in the given text.
 */
export function fixMojibake(text: string): string {
  let fixed = text;

  // 1. Remove replacement characters (U+FFFD)
  fixed = fixed.replace(/\uFFFD/g, '');

  // 2. Remove control characters (preserve tab, newline, carriage return)
  fixed = fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. Remove invalid surrogate pair characters
  fixed = fixed.replace(/[\uD800-\uDFFF]/g, '');

  // 4. Repair UTF-8 -> Latin-1 misinterpretation and double encoding
  fixed = fixUtf8Latin1(fixed);

  // 5. Normalize consecutive whitespace
  fixed = fixed.replace(/[ \t]+/g, ' ');

  // 6. Normalize excessive newlines (limit 3+ consecutive newlines to 2)
  fixed = fixed.replace(/\n{3,}/g, '\n\n');

  return fixed.trim();
}

/**
 * Sanitize markdown content by detecting and fixing mojibake (main entry point).
 */
export function sanitizeMarkdownContent(text: string): SanitizeResult {
  const originalLength = text.length;
  const detection = detectMojibake(text);

  let content = text;
  let wasFixed = false;
  const issues: string[] = [];

  if (detection.hasMojibake) {
    const fixedText = fixMojibake(text);

    // Re-validate after fix
    const redetection = detectMojibake(fixedText);

    // Only adopt the fix if the mojibake score improved
    if (redetection.score < detection.score) {
      content = fixedText;
      wasFixed = true;
      issues.push(`文字化けを修正 (スコア: ${detection.score} → ${redetection.score})`);
      issues.push(...detection.issues);
    } else {
      // Keep original text if the fix was not effective
      content = text;
      issues.push('文字化けを検出したが修正で品質が改善されませんでした');
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
