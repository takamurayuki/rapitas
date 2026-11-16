/**
 * companion-intent tests: which consultation sentences are "伴走して" / "伴走をやめて"
 */
import { describe, expect, test } from 'bun:test';
import { detectCompanionRequest } from './companion-intent';

describe('detectCompanionRequest', () => {
  test.each([
    'このタスクを伴走して',
    '伴走してください',
    '伴走をお願い',
    'これを伴走対象にして',
    '伴走を始めて',
    '伴走して欲しい',
  ])('start: %s', (text) => {
    expect(detectCompanionRequest(text)).toBe('start');
  });

  test.each([
    '伴走をやめて',
    '伴走はもういらない',
    '伴走対象から外して',
    '伴走を終了して',
    '伴走しないで',
    '伴走を止めて',
  ])('stop: %s', (text) => {
    expect(detectCompanionRequest(text)).toBe('stop');
  });

  test.each([
    '伴走って何？',
    'これは伴走してる？',
    'いま伴走中？',
    '伴走していますか',
    '完了条件は？',
    'このタスクを分析して',
    '伴走',
  ])('not a request: %s', (text) => {
    expect(detectCompanionRequest(text)).toBeNull();
  });
});
