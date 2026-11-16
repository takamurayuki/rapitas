/**
 * pr-head-lookup.test
 *
 * The cleanup sweeps ask GitHub one question — which PRs were opened from this
 * branch, in what state, at which head commit — and must be able to tell
 * "none" apart from "could not ask". The second has to come back as null so
 * the caller keeps the worktree/branch instead of reading silence as consent.
 */
import { describe, test, expect } from 'bun:test';
import { listPullRequestsForHead } from './pr-head-lookup';
import { parseOwnerRepo } from './owner-repo';

const repo = parseOwnerRepo('https://github.com/takamurayuki/rapitas.git');
const resolveRepo = () => Promise.resolve(repo);

describe('listPullRequestsForHead', () => {
  test('returns only PRs whose head is exactly this branch, with state and head commit', async () => {
    let argv: string[] = [];
    const gh = (args: string[]) => {
      argv = args;
      return Promise.resolve(
        JSON.stringify([
          { number: 7, state: 'MERGED', headRefName: 'feature/x', headRefOid: 'a'.repeat(40) },
          { number: 8, state: 'OPEN', headRefName: 'feature/x-2', headRefOid: 'b'.repeat(40) },
        ]),
      );
    };
    const prs = await listPullRequestsForHead('/repo', 'feature/x', { resolveRepo, gh });
    expect(prs).toEqual([
      { number: 7, state: 'MERGED', headRefName: 'feature/x', headRefOid: 'a'.repeat(40) },
    ]);
    expect(argv).toContain('--head');
    expect(argv).toContain('feature/x');
    expect(argv[argv.indexOf('--state') + 1]).toBe('all');
    expect(argv[argv.indexOf('--repo') + 1]).toBe('takamurayuki/rapitas');
  });

  test('an empty answer is "no PRs", not "unknown"', async () => {
    const prs = await listPullRequestsForHead('/repo', 'b', {
      resolveRepo,
      gh: () => Promise.resolve(''),
    });
    expect(prs).toEqual([]);
  });

  test('null when the repository cannot be resolved', async () => {
    const prs = await listPullRequestsForHead('/repo', 'b', {
      resolveRepo: () => Promise.resolve(null),
      gh: () => Promise.resolve('[]'),
    });
    expect(prs).toBeNull();
  });

  test('null when gh fails or answers something unparseable', async () => {
    const failing = await listPullRequestsForHead('/repo', 'b', {
      resolveRepo,
      gh: () => Promise.reject(new Error('gh: not logged in')),
    });
    expect(failing).toBeNull();
    const garbled = await listPullRequestsForHead('/repo', 'b', {
      resolveRepo,
      gh: () => Promise.resolve('{"oops":1}'),
    });
    expect(garbled).toBeNull();
    const malformedRow = await listPullRequestsForHead('/repo', 'b', {
      resolveRepo,
      gh: () => Promise.resolve(JSON.stringify([{ number: 1, state: 'OPEN', headRefName: 'b' }])),
    });
    expect(malformedRow).toBeNull();
  });
});
