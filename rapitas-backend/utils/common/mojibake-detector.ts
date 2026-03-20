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
        `Detected ${matches.length} UTF-8→Latin-1 misinterpretation patterns: ${matches.slice(0, 3).join(', ')}`,
      );
    }
  }

  // 2. Detect replacement characters (U+FFFD)
  const replacementCharMatches = text.match(/\uFFFD/g);
  if (replacementCharMatches) {
    patterns.replacementChars = replacementCharMatches.length;
    score += patterns.replacementChars * 20;
    issues.push(`Detected ${patterns.replacementChars} replacement characters (�)`);
  }

  // 3. Detect control characters (excluding tab, newline, carriage return)
  const controlCharMatches = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g);
  if (controlCharMatches) {
    patterns.controlChars = controlCharMatches.length;
    score += patterns.controlChars * 10;
    issues.push(`Detected ${patterns.controlChars} control characters`);
  }

  // 4. Detect invalid UTF-8 sequences
  // Invalid use of surrogate pair range
  const surrogateMatches = text.match(/[\uD800-\uDFFF]/g);
  if (surrogateMatches) {
    patterns.invalidSequences.push(...surrogateMatches);
    score += surrogateMatches.length * 25;
    issues.push(`Detected ${surrogateMatches.length} invalid surrogate pair characters`);
  }

  // 5. Anomalous patterns in Japanese context
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
      issues.push(`Detected ${brokenMatches.length} Japanese mojibake patterns`);
    }
  }

  // Cap score at 100
  score = Math.min(score, 100);

  return {
    hasMojibake: score > 20, // Score above 20 is considered mojibake
    score,
    issues,
    patterns,
  };
}

/**
 * Repair UTF-8 -> Latin-1 misinterpretation.
 */
function fixUtf8Latin1(text: string): string {
  let fixed = text;

  // Attempt to repair typical UTF-8 3-byte character corruption
  // NOTE: Limited to patterns that can be reliably fixed to avoid data corruption

  // NOTE: Only repair patterns that can be reliably reversed (e.g. Ã£Â\x81\x82 -> U+3042)
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

  // More general but safe repair: remove obviously corrupted byte sequences
  // (only when Japanese content is present)
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(fixed);
  if (hasJapanese) {
    // Remove clearly invalid byte sequences following Japanese characters
    fixed = fixed.replace(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][\x80-\xFF]+/g, (match) => {
      return match.charAt(0); // Keep only the Japanese character, strip trailing bytes
    });
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

  // 4. Repair UTF-8 -> Latin-1 misinterpretation
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
      issues.push(`Fixed mojibake (score: ${detection.score} → ${redetection.score})`);
      issues.push(...detection.issues);
    } else {
      // Keep original text if the fix was not effective
      content = text;
      issues.push('Mojibake detected but quality did not improve with fixes');
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
