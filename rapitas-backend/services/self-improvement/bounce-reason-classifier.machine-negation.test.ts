/**
 * bounce-reason-classifier — negation around the machine word
 *
 * The diff review sent task 1541 back three times on criterion 1. The last
 * gap: a sentence carrying `self-contradict` skipped the Japanese negation
 * check, so 「verify.md は self-contradicts ではない」 was counted and filed
 * as a gate-misjudgment candidate.
 */
import { describe, it, expect } from 'bun:test';
import { classifyBounceReason, isAffirmativeContradiction } from './bounce-reason-classifier';

const NEGATED: readonly string[] = [
  '検証レポートは self-contradicts ではない',
  'verify.md は self-contradicts とは言えません',
  'verify.md self-contradicts の判定は当たらなかった',
  'self-contradiction was not found in verify.md',
  'verify.md does not self-contradict',
  'no self-contradiction in the report',
];

const AFFIRMED: readonly string[] = [
  'verify.md self-contradicts the measured gate result',
  'self-contradicts',
  'verify.md self-contradicts: task #12 port 3001',
];

describe('a sentence with the machine word', () => {
  it.each(NEGATED)('is not a contradiction when negated: %s', (sentence) => {
    expect(isAffirmativeContradiction(sentence)).toBe(false);
    expect(classifyBounceReason(sentence)).not.toBe('verify_contradiction');
  });

  it.each(AFFIRMED)('is still a contradiction when affirmed: %s', (sentence) => {
    expect(isAffirmativeContradiction(sentence)).toBe(true);
    expect(classifyBounceReason(sentence)).toBe('verify_contradiction');
  });
});
