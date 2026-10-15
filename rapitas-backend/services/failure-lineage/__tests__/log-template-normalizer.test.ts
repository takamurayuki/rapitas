/**
 * log-template-normalizer unit tests
 *
 * Covers level detection, placeholder substitution, convergence of
 * recurring events, the 2000-char cap and resource extraction.
 */
import { describe, test, expect } from 'bun:test';
import {
  detectLevel,
  extractResources,
  MAX_LINE_LENGTH,
  normalizeTemplate,
  templateIdOf,
} from '../log-template-normalizer';

describe('detectLevel', () => {
  test('detects ERROR and WARN on word boundaries', () => {
    expect(detectLevel('stdout', '[2026-10-15] ERROR push failed')).toBe('ERROR');
    expect(detectLevel('stdout', 'WARN disk almost full')).toBe('WARN');
    expect(detectLevel('stdout', 'WARNING: deprecated')).toBe('WARN');
  });

  test('ERROR wins over WARN when both appear', () => {
    expect(detectLevel('stdout', 'WARN then ERROR')).toBe('ERROR');
  });

  test('returns null for lines without a level and for look-alike words', () => {
    expect(detectLevel('stdout', 'all good')).toBeNull();
    expect(detectLevel('stdout', 'TERRORIST WARNED')).toBeNull();
    expect(detectLevel('stdout', '')).toBeNull();
  });

  test('plain stderr is not an error, logType=error is', () => {
    expect(detectLevel('stderr', 'progress 50%')).toBeNull();
    expect(detectLevel('error', 'anything')).toBe('ERROR');
  });
});

describe('normalizeTemplate', () => {
  test('replaces numbers, uuids, hashes, paths and branches', () => {
    const t = normalizeTemplate(
      'ERROR task 1275 failed 3 times id 3f2b8a1e-1111-4222-8333-444455556666 at abc1234def on feature/t1275-x in /var/log/app/run.log',
    );
    expect(t).toContain('<NUM>');
    expect(t).toContain('<UUID>');
    expect(t).toContain('<HASH>');
    expect(t).toContain('<BRANCH>');
    expect(t).toContain('<PATH>');
    expect(t).not.toMatch(/1275|abc1234def|\/var\/log/);
  });

  test('replaces windows paths', () => {
    expect(normalizeTemplate('ERROR cannot open C:\\Projects\\x\\a.ts now')).toBe(
      'ERROR cannot open <PATH> now',
    );
  });

  test('same event with different variables converges to one template id', () => {
    const a = normalizeTemplate('ERROR push rejected for feature/a-1 after 3 retries');
    const b = normalizeTemplate('ERROR push rejected for feature/b-22 after 7 retries');
    expect(a).toBe(b);
    expect(templateIdOf(a)).toBe(templateIdOf(b));
  });

  test('different events keep different template ids', () => {
    expect(templateIdOf(normalizeTemplate('ERROR a'))).not.toBe(
      templateIdOf(normalizeTemplate('ERROR b')),
    );
  });

  test('handles empty and over-long input', () => {
    expect(normalizeTemplate('')).toBe('');
    const long = 'ERROR ' + 'x '.repeat(5000);
    expect(normalizeTemplate(long).length).toBeLessThanOrEqual(MAX_LINE_LENGTH);
  });
});

describe('extractResources', () => {
  test('extracts branch and task keys, sorted and unique', () => {
    expect(
      extractResources(
        'ERROR task 12 push rejected for feature/t12-x; branch feature/t12-x task 12',
      ),
    ).toEqual(['branch:feature/t12-x', 'task:12']);
  });

  test('returns empty array when nothing matches', () => {
    expect(extractResources('ERROR boom')).toEqual([]);
  });
});
