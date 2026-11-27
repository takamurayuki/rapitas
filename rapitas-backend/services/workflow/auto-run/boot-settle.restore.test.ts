/**
 * boot-settle.restore.test
 *
 * The post-restart restore of themes parked by a restart wait must run after the
 * deferred recovery whether that recovery succeeded or failed (task 1562).
 */
import { describe, test, expect, mock } from 'bun:test';

let restoreCalls = 0;
mock.module('../../scheduling/auto-restart-merged-code/restart-resume', () => ({
  resumeThemesAfterRestart: async () => {
    restoreCalls += 1;
    return { resumed: [], skipped: [] };
  },
}));

const { deferAutoRunRecovery } = await import('./boot-settle');

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('deferAutoRunRecovery restores parked themes', () => {
  test('after a successful recovery', async () => {
    restoreCalls = 0;
    deferAutoRunRecovery(async () => {}, { settleMs: 0 });
    await settle();
    expect(restoreCalls).toBe(1);
  });

  test('also when the recovery itself rejects', async () => {
    restoreCalls = 0;
    deferAutoRunRecovery(
      async () => {
        throw new Error('recovery failed');
      },
      { settleMs: 0 },
    );
    await settle();
    expect(restoreCalls).toBe(1);
  });
});
