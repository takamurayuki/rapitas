/**
 * workflow-prerequisites-gate.test
 *
 * A manual start is refused while a prerequisite is unfinished, and says
 * which (#1559). A lookup that fails must not stop every start.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let open: Array<{ id: number; title: string; status: string }> = [];
let fail = false;
mock.module('../task/task-dependencies', () => ({
  openPrerequisites: async () => {
    if (fail) throw new Error('db down');
    return open;
  },
  prerequisitesMessage: (o: typeof open) => `先に: ${o.map((p) => `#${p.id}`).join(',')}`,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { refuseWhilePrerequisitesOpen } = await import('./workflow-prerequisites-gate');

beforeEach(() => {
  open = [];
  fail = false;
});

describe('starting a task that waits for others', () => {
  it('is refused while a prerequisite is open, naming it, and keeps the status', async () => {
    open = [{ id: 12, title: 'API を作る', status: 'in-progress' }];
    const r = await refuseWhilePrerequisitesOpen(20, 'researcher', 'draft');
    expect(r).toEqual({ success: false, role: 'researcher', status: 'draft', error: '先に: #12' });
  });

  it('goes on once every prerequisite is done', async () => {
    expect(await refuseWhilePrerequisitesOpen(20, 'researcher', 'draft')).toBeNull();
  });

  it('goes on when the prerequisites cannot be read', async () => {
    fail = true;
    expect(await refuseWhilePrerequisitesOpen(20, 'researcher', 'draft')).toBeNull();
  });
});
