/**
 * automation-policy.landing-mode.test
 *
 * Unit tests for resolveLandingMode — the precedence that decides where a task's
 * completion is marked (none < commit < pr < merge).
 */
import { describe, it, expect } from 'bun:test';
import { resolveLandingMode } from './automation-policy';

const policy = (autoCommit: boolean, autoCreatePR: boolean, autoMergePR: boolean) => ({
  autoCommit,
  autoCreatePR,
  autoMergePR,
});

describe('resolveLandingMode', () => {
  it('returns none when every automation flag is off', () => {
    expect(resolveLandingMode(policy(false, false, false))).toBe('none');
  });

  it('returns commit when only autoCommit is on', () => {
    expect(resolveLandingMode(policy(true, false, false))).toBe('commit');
  });

  it('returns pr when autoCreatePR is on (PR supersedes direct commit)', () => {
    expect(resolveLandingMode(policy(true, true, false))).toBe('pr');
    expect(resolveLandingMode(policy(false, true, false))).toBe('pr');
  });

  it('returns merge when autoMergePR is on (merge supersedes pr and commit)', () => {
    expect(resolveLandingMode(policy(true, true, true))).toBe('merge');
    expect(resolveLandingMode(policy(false, false, true))).toBe('merge');
  });
});
