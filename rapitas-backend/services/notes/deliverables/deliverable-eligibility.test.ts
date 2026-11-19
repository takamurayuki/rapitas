/**
 * deliverable-eligibility.test
 *
 * Q5 as decided: a completed task gets a deliverable note automatically when
 * its verify.md (or, failing that, research.md) has at least 200 characters
 * without headings and blank lines.
 */
import { describe, it, expect } from 'bun:test';
import {
  DELIVERABLE_MIN_CHARS,
  meaningfulLength,
  pickDeliverableKind,
} from './deliverable-eligibility';

describe('deliverable eligibility (Q5)', () => {
  const body = (n: number) => `# 見出し\n\n## 小見出し\n\n${'あ'.repeat(n)}\n`;

  it('does not count headings and blank lines', () => {
    expect(meaningfulLength(body(10))).toBe(10);
  });

  it('needs at least the threshold', () => {
    expect(pickDeliverableKind({ verify: body(DELIVERABLE_MIN_CHARS - 1) })).toBeNull();
    expect(pickDeliverableKind({ verify: body(DELIVERABLE_MIN_CHARS) })).toBe('verify');
  });

  it('prefers verify.md, falling back to research.md', () => {
    expect(pickDeliverableKind({ verify: body(300), research: body(300) })).toBe('verify');
    expect(pickDeliverableKind({ verify: body(5), research: body(300) })).toBe('research');
    expect(pickDeliverableKind({})).toBeNull();
  });
});
