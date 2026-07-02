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
  it.each([
    {
      name: 'none when every automation flag is off',
      cases: [[false, false, false]] as [boolean, boolean, boolean][],
      expected: 'none',
    },
    {
      name: 'commit when only autoCommit is on',
      cases: [[true, false, false]] as [boolean, boolean, boolean][],
      expected: 'commit',
    },
    {
      name: 'pr when autoCreatePR is on (PR supersedes direct commit)',
      cases: [
        [true, true, false],
        [false, true, false],
      ] as [boolean, boolean, boolean][],
      expected: 'pr',
    },
    {
      name: 'merge when autoMergePR is on (merge supersedes pr and commit)',
      cases: [
        [true, true, true],
        [false, false, true],
      ] as [boolean, boolean, boolean][],
      expected: 'merge',
    },
  ])('returns $name', ({ cases, expected }) => {
    for (const [autoCommit, autoCreatePR, autoMergePR] of cases) {
      expect(resolveLandingMode(policy(autoCommit, autoCreatePR, autoMergePR))).toBe(expected);
    }
  });
});
