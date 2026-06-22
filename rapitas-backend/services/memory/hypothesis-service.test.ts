/**
 * hypothesis-service.test
 *
 * Pins the two gates that make the ledger trustworthy: the falsifiability gate
 * (a hypothesis must be a concrete testable claim) and the evidence gate (only a
 * concrete artifact counts — the defense against an agent "proving" a hypothesis
 * just to close it). Pure functions, no DB.
 */
import { describe, test, expect } from 'bun:test';
import {
  checkFalsifiable,
  isConcreteArtifact,
  normalizeDomain,
} from './hypothesis-service';

describe('checkFalsifiable', () => {
  test('accepts a concrete testable claim', () => {
    expect(
      checkFalsifiable('git-exec のキャッシュ層導入で PR 取得の往復回数が減る'),
    ).toBeNull();
  });

  test('rejects a too-short statement', () => {
    expect(checkFalsifiable('速い')).not.toBeNull();
    expect(checkFalsifiable('x')).not.toBeNull();
  });

  test('rejects a bare question (no claim to test)', () => {
    expect(checkFalsifiable('キャッシュ導入で速くなるのは本当か？')).not.toBeNull();
    expect(checkFalsifiable('Is the cache layer actually faster?')).not.toBeNull();
  });

  test('trims before measuring length', () => {
    expect(checkFalsifiable('          ')).not.toBeNull();
  });
});

describe('isConcreteArtifact', () => {
  test('accepts file:line', () => {
    expect(isConcreteArtifact('services/github/git-exec.ts:42')).toBe(true);
  });

  test('accepts a test name', () => {
    expect(isConcreteArtifact('worktree-usable.test.ts pass 8/8')).toBe(true);
  });

  test('accepts a measurement / number', () => {
    expect(isConcreteArtifact('13.8s -> 2.5s')).toBe(true);
  });

  test('accepts a #PR / path', () => {
    expect(isConcreteArtifact('#226')).toBe(true);
    expect(isConcreteArtifact('routes/memory/')).toBe(true);
  });

  test('rejects hand-wavy assertions', () => {
    expect(isConcreteArtifact('seems faster')).toBe(false);
    expect(isConcreteArtifact('it works')).toBe(false);
    expect(isConcreteArtifact('')).toBe(false);
    expect(isConcreteArtifact('  ')).toBe(false);
  });
});

describe('normalizeDomain', () => {
  test('passes through valid domains', () => {
    expect(normalizeDomain('performance')).toBe('performance');
    expect(normalizeDomain('agent-behavior')).toBe('agent-behavior');
  });

  test('defaults unknown to codebase', () => {
    expect(normalizeDomain('nonsense')).toBe('codebase');
    expect(normalizeDomain(undefined)).toBe('codebase');
    expect(normalizeDomain(42)).toBe('codebase');
  });
});
