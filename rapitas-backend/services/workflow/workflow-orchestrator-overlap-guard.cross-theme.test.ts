/**
 * workflow-orchestrator-overlap-guard.cross-theme.test
 *
 * Task 1552: the overlap guard's default open-PR lookup must cover every theme
 * on the same repository (workingDirectory), so a theme split (theme 1 next to
 * theme 49) cannot hide the other theme's PR. The PR cache is mocked: the
 * repository lookup returns theme 49's PR, the theme-only lookup returns none.
 * Before the fix the guard used the theme-only lookup and did not hold.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../observability', () => ({ logCycleEvent: () => {} }));
mock.module('../scheduling/merge-barrier/merge-barrier', () => ({
  getMergeBarrierMaxHoldMs: () => 30 * 60 * 1000,
}));
mock.module('../../config', () => ({ prisma: {} }));

const SHARED = 'rapitas-frontend/src/app/home/_components/AutoRunProgressStrip.tsx';
const repoCalls: Array<{ themeId: number; cwd: string | null | undefined }> = [];
/** PRs per theme; theme 49 is the split-off theme on the same repository. */
let prsByRepository: Array<{ prNumber: number; linkedTaskId: number; createdAt: Date }> = [];
mock.module('./auto-run/open-pr-files-cache', () => ({
  getOpenAutoPrsForTheme: async () => [],
  getOpenAutoPrsForRepository: async (_p: unknown, themeId: number, cwd?: string | null) => {
    repoCalls.push({ themeId, cwd });
    return prsByRepository;
  },
  getPrChangedFiles: async () => [SHARED],
}));

const { guardImplementOverlap, resetOverlapGuardState } =
  await import('./workflow-orchestrator-overlap-guard');

const IMPLEMENTER = { role: 'implementer', outputFile: null, nextStatus: 'in_progress' } as const;
const TASK = { themeId: 1, theme: { workingDirectory: 'C:\\Projects\\rapitas' } };
const NOW = 5_000_000;

/** Every collaborator except openPrs/prFiles, so the default lookup is what runs. */
const deps = {
  artifact: async () => `変更: \`${SHARED}\``,
  parseFiles: (c: string) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
  overlap: async (a: string[], b: string[]) => b.filter((f) => a.includes(f)),
  isParked: async () => false,
  isHalted: async () => false,
  ownPr: async () => null,
  now: () => NOW,
};

beforeEach(() => {
  resetOverlapGuardState();
  repoCalls.length = 0;
  prsByRepository = [];
});

describe('guardImplementOverlap — open PRs of other themes on the same repository', () => {
  test('a theme-49 PR touching the same file holds theme 1 implementer', async () => {
    prsByRepository = [{ prNumber: 1801, linkedTaskId: 1531, createdAt: new Date(NOW - 60_000) }];
    const r = await guardImplementOverlap(1552, IMPLEMENTER, TASK, 'plan_approved', deps);
    expect(r.done).toBe(true);
    if (r.done) expect(r.result.held).toContain('#1801');
    expect(repoCalls).toEqual([{ themeId: 1, cwd: 'C:\\Projects\\rapitas' }]);
  });

  test('no PR on the repository → not held', async () => {
    const r = await guardImplementOverlap(1552, IMPLEMENTER, TASK, 'plan_approved', deps);
    expect(r.done).toBe(false);
  });
});
