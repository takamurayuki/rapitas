/**
 * git-io.test
 *
 * Verifies the git I/O layer never throws and maps success/failure to
 * bool/number|null results. runGitCommand is mocked (no real git runs).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

type GitHandler = (args: string[]) => Promise<string>;

// Swappable per test: receives the git args, returns stdout or throws.
let gitHandler: GitHandler = () => Promise.resolve('');
const runGitCommandMock = mock((args: string[]) => gitHandler(args));

mock.module('../../github/git-exec', () => ({
  runGitCommand: runGitCommandMock,
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const {
  captureStartupCommit,
  fetchAndCountAhead,
  isWorkingTreeClean,
  fastForwardToRemote,
  listChangedPaths,
} = await import('./git-io');

beforeEach(() => {
  runGitCommandMock.mockClear();
  gitHandler = () => Promise.resolve('');
});

describe('captureStartupCommit', () => {
  test('returns the trimmed HEAD hash', async () => {
    gitHandler = (args) => {
      expect(args).toEqual(['rev-parse', 'HEAD']);
      return Promise.resolve('abc123def456');
    };
    expect(await captureStartupCommit()).toBe('abc123def456');
  });

  test('returns null when git fails', async () => {
    gitHandler = () => Promise.reject(new Error('not a git repository'));
    expect(await captureStartupCommit()).toBeNull();
  });

  test('returns null on empty output', async () => {
    gitHandler = () => Promise.resolve('');
    expect(await captureStartupCommit()).toBeNull();
  });
});

describe('fetchAndCountAhead', () => {
  test('fetches origin/<branch> then counts startupCommit..origin/<branch>', async () => {
    const calls: string[][] = [];
    gitHandler = (args) => {
      calls.push(args);
      return Promise.resolve(args[0] === 'rev-list' ? '4' : '');
    };
    expect(await fetchAndCountAhead('abc123', 'develop')).toBe(4);
    expect(calls[0]).toEqual(['fetch', 'origin', 'develop']);
    expect(calls[1]).toEqual(['rev-list', '--count', 'abc123..origin/develop']);
  });

  test('returns null when fetch fails', async () => {
    gitHandler = (args) =>
      args[0] === 'fetch'
        ? Promise.reject(new Error('Could not resolve host'))
        : Promise.resolve('4');
    expect(await fetchAndCountAhead('abc123', 'develop')).toBeNull();
  });

  test('returns null when rev-list fails', async () => {
    gitHandler = (args) =>
      args[0] === 'rev-list' ? Promise.reject(new Error('unknown revision')) : Promise.resolve('');
    expect(await fetchAndCountAhead('abc123', 'develop')).toBeNull();
  });

  test('returns null on non-numeric rev-list output', async () => {
    gitHandler = (args) => Promise.resolve(args[0] === 'rev-list' ? 'garbage' : '');
    expect(await fetchAndCountAhead('abc123', 'develop')).toBeNull();
  });

  test('returns 0 when origin has no new commits', async () => {
    gitHandler = (args) => Promise.resolve(args[0] === 'rev-list' ? '0' : '');
    expect(await fetchAndCountAhead('abc123', 'develop')).toBe(0);
  });
});

describe('listChangedPaths', () => {
  test('runs diff --name-only startupCommit..origin/<branch> and splits lines', async () => {
    gitHandler = (args) => {
      expect(args).toEqual(['diff', '--name-only', 'abc123..origin/develop']);
      return Promise.resolve('services/workflow/a.ts\r\nrapitas-frontend/src/b.tsx\n\n');
    };
    expect(await listChangedPaths('abc123', 'develop')).toEqual([
      'services/workflow/a.ts',
      'rapitas-frontend/src/b.tsx',
    ]);
  });

  test('returns [] on empty diff output', async () => {
    gitHandler = () => Promise.resolve('');
    expect(await listChangedPaths('abc123', 'develop')).toEqual([]);
  });

  test('returns [] when git fails (unknown change set)', async () => {
    gitHandler = () => Promise.reject(new Error('bad revision'));
    expect(await listChangedPaths('abc123', 'develop')).toEqual([]);
  });
});

describe('isWorkingTreeClean', () => {
  test('true when porcelain output is empty', async () => {
    gitHandler = (args) => {
      expect(args).toEqual(['status', '--porcelain']);
      return Promise.resolve('');
    };
    expect(await isWorkingTreeClean()).toBe(true);
  });

  test('false when porcelain lists changes', async () => {
    gitHandler = () => Promise.resolve(' M services/foo.ts');
    expect(await isWorkingTreeClean()).toBe(false);
  });

  test('false when git status fails (unknown state = dirty)', async () => {
    gitHandler = () => Promise.reject(new Error('boom'));
    expect(await isWorkingTreeClean()).toBe(false);
  });
});

describe('fastForwardToRemote', () => {
  test('true on successful ff-only merge with correct args', async () => {
    gitHandler = (args) => {
      expect(args).toEqual(['merge', '--ff-only', 'origin/develop']);
      return Promise.resolve('Updating abc..def\nFast-forward');
    };
    expect(await fastForwardToRemote('develop')).toBe(true);
  });

  test('false when merge fails (divergence)', async () => {
    gitHandler = () => Promise.reject(new Error('Not possible to fast-forward, aborting.'));
    expect(await fastForwardToRemote('develop')).toBe(false);
  });
});
