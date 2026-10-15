/**
 * preview-session-manager.test.ts
 *
 * Covers the parts safe to exercise without real filesystem/process/browser
 * work: getPreviewStatus/stopPreview on a task that never had a session.
 * startPreview itself (worktree resolution, dev-server launch, Playwright)
 * is exercised indirectly via preview-routes.test.ts's mocks.
 */
import { describe, it, expect } from 'bun:test';
import { getPreviewStatus, stopPreview, stopAllPreviewSessions } from './preview-session-manager';

describe('getPreviewStatus', () => {
  it('returns active:false for a task with no session', () => {
    expect(getPreviewStatus(999_999)).toEqual({ active: false });
  });
});

describe('stopPreview', () => {
  it('is a no-op for a task with no session', async () => {
    await expect(stopPreview(999_999)).resolves.toBeUndefined();
  });
});

describe('stopAllPreviewSessions', () => {
  it('is a no-op when nothing is active or in progress', async () => {
    await expect(stopAllPreviewSessions()).resolves.toBeUndefined();
  });
});
