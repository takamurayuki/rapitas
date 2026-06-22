/**
 * workflow-memory-context.test
 *
 * Unit tests for the pure outcome-weighting and rendering logic.
 */
import { describe, it, expect } from 'bun:test';
import {
  applyOutcomeWeighting,
  renderMemorySection,
  type MemoryEntry,
  type EntryOutcome,
} from './workflow-memory-context';

const entry = (over: Partial<MemoryEntry>): MemoryEntry => ({
  title: 't',
  content: 'c',
  category: 'lesson',
  similarity: 0.6,
  ...over,
});

describe('applyOutcomeWeighting', () => {
  it('ranks a first-try success above an equally-similar blocked entry', () => {
    const entries = [
      entry({ title: 'blocked', similarity: 0.6, sourceTaskId: 1 }),
      entry({ title: 'success', similarity: 0.6, sourceTaskId: 2 }),
    ];
    const outcomes = new Map<number, EntryOutcome>([
      [1, 'blocked'],
      [2, 'first_try'],
    ]);
    const ranked = applyOutcomeWeighting(entries, outcomes);
    expect(ranked[0]!.title).toBe('success');
    expect(ranked[1]!.title).toBe('blocked');
  });

  it('attaches the outcome to each entry', () => {
    const ranked = applyOutcomeWeighting([entry({ sourceTaskId: 1 })], new Map([[1, 'completed']]));
    expect(ranked[0]!.outcome).toBe('completed');
  });

  it('leaves outcome null when the source task has no recorded outcome', () => {
    const ranked = applyOutcomeWeighting([entry({ sourceTaskId: 9 })], new Map());
    expect(ranked[0]!.outcome).toBeNull();
  });

  it('keeps (does not drop) blocked entries — failures are lessons', () => {
    const ranked = applyOutcomeWeighting(
      [entry({ title: 'fail', sourceTaskId: 1 })],
      new Map<number, EntryOutcome>([[1, 'blocked']]),
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.outcome).toBe('blocked');
  });

  it('a strongly-similar blocked entry can still outrank a weak success', () => {
    const ranked = applyOutcomeWeighting(
      [
        entry({ title: 'weakSuccess', similarity: 0.5, sourceTaskId: 2 }),
        entry({ title: 'strongFail', similarity: 0.9, sourceTaskId: 1 }),
      ],
      new Map<number, EntryOutcome>([
        [1, 'blocked'], // 0.9 * 0.7 = 0.63
        [2, 'first_try'], // 0.5 * 1.2 = 0.60
      ]),
    );
    expect(ranked[0]!.title).toBe('strongFail');
  });
});

describe('renderMemorySection', () => {
  it('returns empty string with no entries', () => {
    expect(renderMemorySection([], 'ja')).toBe('');
  });

  it('renders a blocked entry with the failure-lesson marker', () => {
    const md = renderMemorySection([entry({ outcome: 'blocked' })], 'ja');
    expect(md).toContain('⚠️');
    expect(md).toContain('失敗の教訓');
  });

  it('renders a first-try success marker', () => {
    const md = renderMemorySection([entry({ outcome: 'first_try' })], 'en');
    expect(md).toContain('first-try success');
  });

  it('omits the marker when outcome is absent', () => {
    const md = renderMemorySection([entry({ outcome: null })], 'ja');
    expect(md).not.toContain('⚠️');
    expect(md).not.toContain('✅');
  });

  it('labels contested (conflict) knowledge so the agent verifies it', () => {
    const md = renderMemorySection([entry({ validationStatus: 'conflict' })], 'ja');
    expect(md).toContain('矛盾あり');
    const en = renderMemorySection([entry({ validationStatus: 'conflict' })], 'en');
    expect(en).toContain('contested');
  });

  it('does not label validated / pending knowledge as contested', () => {
    const md = renderMemorySection([entry({ validationStatus: 'validated' })], 'ja');
    expect(md).not.toContain('矛盾あり');
  });
});
