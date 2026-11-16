// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * task-get-revision.test
 *
 * PATCH /tasks/:id refuses a spec edit without the criteria revision it was
 * based on, and GET /tasks/:id did not serve that revision — an editor had
 * to recompute it (found in the #1545 trial). The task detail's spec editor
 * reads it from here (#1555).
 */
import { describe, it, expect, mock } from 'bun:test';

const row = {
  id: 1498,
  title: 'ログに理由を残す',
  goals: '["理由が読める"]',
  constraints: null,
  acceptanceCriteria: '["テストが通る"]',
};

mock.module('../../config/database', () => ({
  prisma: { task: { findUnique: async () => row } },
}));
mock.module('../../config', () => ({
  prisma: {},
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../services/agent-execution/task-active-time', () => ({
  computeTaskActiveTime: async () => ({ activeMs: 0 }),
}));

const { tasksRoutes } = await import('./tasks');
const { computeCriteriaRevision } = await import('../../services/task/task-criteria-revision');

describe('GET /tasks/:id', () => {
  it('serves the criteria revision a spec edit must send back', async () => {
    const res = await tasksRoutes.handle(new Request('http://localhost/tasks/1498'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.criteriaRevision).toBe(computeCriteriaRevision(row));
  });
});
