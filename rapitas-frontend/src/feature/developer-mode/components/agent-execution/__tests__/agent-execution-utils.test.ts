/**
 * agent-execution-utils tests
 *
 * Covers the token/cost/countdown formatters and the question-option parser
 * (all its numbered-list / explicit-option / Japanese and English yes-no /
 * multi-question / fallback branches), none of which had prior test
 * coverage.
 */
import {
  formatTokenCount,
  formatCostUsd,
  formatCountdown,
  parseQuestionOptions,
} from '../agent-execution-utils';

describe('formatTokenCount', () => {
  test('formats sub-thousand counts as-is', () => {
    expect(formatTokenCount(42)).toBe('42 tokens');
    expect(formatTokenCount(0)).toBe('0 tokens');
  });

  test('formats thousands with a K suffix', () => {
    expect(formatTokenCount(1200)).toBe('1.2K tokens');
    expect(formatTokenCount(950_000)).toBe('950.0K tokens');
  });

  test('formats millions with an M suffix', () => {
    expect(formatTokenCount(2_500_000)).toBe('2.5M tokens');
  });
});

describe('formatCostUsd', () => {
  test('formats zero, negative, and non-finite costs as $0.00', () => {
    expect(formatCostUsd(0)).toBe('$0.00');
    expect(formatCostUsd(-1)).toBe('$0.00');
    expect(formatCostUsd(NaN)).toBe('$0.00');
    expect(formatCostUsd(Infinity)).toBe('$0.00');
  });

  test('uses 4 decimal places below one cent', () => {
    expect(formatCostUsd(0.0032)).toBe('$0.0032');
  });

  test('uses 2 decimal places at or above one cent', () => {
    expect(formatCostUsd(0.01)).toBe('$0.01');
    expect(formatCostUsd(1.238)).toBe('$1.24');
  });
});

describe('formatCountdown', () => {
  test('formats seconds as zero-padded mm:ss', () => {
    expect(formatCountdown(125)).toBe('2:05');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('parseQuestionOptions', () => {
  const t = (key: string) => `[${key}]`;

  test('returns null for empty input', () => {
    expect(parseQuestionOptions('')).toBeNull();
  });

  // NOTE(bug): The explicit "Options:" branch is effectively dead code. Its regex
  // `((?:[A-D]\)|[①-④]|\d\))[^\n]+\n?)+` uses a repeated *capturing* group, and JS
  // retains only the LAST iteration in `optionsMatch[1]`, so at most one option is
  // ever extracted and the `options.length >= 2` guard can never pass. The A)/B)
  // labels are therefore never returned; input instead falls through to the single
  // yes/no-question branch (the first line ends in "?"). This characterizes that.
  test('explicit "Options:" A)/B) list is NOT parsed into its options (repeated-capture bug)', () => {
    const result = parseQuestionOptions(
      'Which approach?\nOptions:\nA) Minimal\nB) Comprehensive\n',
      t,
    );
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(['[yes]', '[no]']);
  });

  test('parses a numbered list format', () => {
    const result = parseQuestionOptions('Pick one\n1. First option\n2. Second option');
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(['First option', 'Second option']);
    expect(result!.text).toBe('Pick one');
  });

  test('parses multiple Japanese yes/no questions into subQuestions', () => {
    const result = parseQuestionOptions(
      '以下について確認します\nDBを変更しますか？\nテストを追加しますか？',
      t,
    );
    expect(result).not.toBeNull();
    expect(result!.isMultiQuestion).toBe(true);
    expect(result!.options).toEqual(['[yesAll]', '[noAll]', '[answerIndividually]']);
    expect(result!.subQuestions).toHaveLength(2);
    expect(result!.subQuestions![0].key).toBe('q0');
  });

  test('parses a single Japanese yes/no question', () => {
    const result = parseQuestionOptions('このまま続行しますか？', t);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(['[yes]', '[no]']);
    expect(result!.subQuestions).toBeUndefined();
  });

  test('parses an English yes/no confirmation question', () => {
    const result = parseQuestionOptions('Would you like to proceed with the deployment', t);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(['[yesEn]', '[noEn]']);
  });

  test('falls back to grouping any multi-line text with 2+ lines containing a mid-line "?"', () => {
    // Neither line ends in "?"/"？" (so isJpQuestionLine doesn't fire) and neither
    // contains a JP question keyword, so this only matches the final catch-all
    // branch (anyQuestionLines), not the earlier JP yes/no branch.
    const result = parseQuestionOptions(
      'Some context\nIs this fine? I think so\nShould we proceed? Not certain',
      t,
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Some context');
    expect(result!.isMultiQuestion).toBe(true);
    expect(result!.subQuestions).toHaveLength(2);
    expect(result!.options).toEqual(['[yesAll]', '[noAll]', '[answerIndividually]']);
  });

  test('returns null when nothing matches any recognized shape', () => {
    // Avoid incidental "yes"/"no"/"confirm" words -- those alone are enough
    // to trigger the English yes/no fallback branch.
    expect(parseQuestionOptions('Everything looks fine and ready to ship.')).toBeNull();
  });

  test('uses the default Japanese translator when none is supplied', () => {
    const result = parseQuestionOptions('本当に削除しますか？');
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(['はい', 'いいえ']);
  });
});
