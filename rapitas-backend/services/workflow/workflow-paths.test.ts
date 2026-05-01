/**
 * Tests for path resolvers — both workflow file dirs and agent-temp dirs.
 * Verifies the new agent-temp location is OUTSIDE any worktree / project so
 * artifacts survive worktree cleanup and work for arbitrary target projects.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getAgentTempBaseDir,
  getAgentTempDir,
  getTaskWorkflowDir,
  getWorkflowBaseDir,
} from './workflow-paths';

const ORIGINAL_DATA_DIR = process.env.RAPITAS_DATA_DIR;

describe('getAgentTempBaseDir', () => {
  beforeEach(() => {
    delete process.env.RAPITAS_DATA_DIR;
  });
  afterEach(() => {
    if (ORIGINAL_DATA_DIR === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = ORIGINAL_DATA_DIR;
  });

  test('defaults to ~/.rapitas/agent-temp when RAPITAS_DATA_DIR is unset', () => {
    const dir = getAgentTempBaseDir();
    expect(dir).toContain('.rapitas');
    expect(dir).toContain('agent-temp');
  });

  test('respects RAPITAS_DATA_DIR override', () => {
    process.env.RAPITAS_DATA_DIR = '/custom/data';
    const dir = getAgentTempBaseDir();
    expect(dir.replace(/\\/g, '/')).toBe('/custom/data/agent-temp');
  });

  test('does NOT live under a project worktree', () => {
    process.env.RAPITAS_DATA_DIR = '/custom/data';
    const dir = getAgentTempBaseDir();
    expect(dir).not.toContain('.worktrees');
    expect(dir).not.toContain('rapitas-frontend');
    expect(dir).not.toContain('rapitas-backend');
  });
});

describe('getAgentTempDir', () => {
  beforeEach(() => {
    process.env.RAPITAS_DATA_DIR = '/custom/data';
  });
  afterEach(() => {
    if (ORIGINAL_DATA_DIR === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = ORIGINAL_DATA_DIR;
  });

  test('uses task and session ids in the path', () => {
    const dir = getAgentTempDir(2097, 555).replace(/\\/g, '/');
    expect(dir).toBe('/custom/data/agent-temp/task-2097/s555');
  });

  test('falls back to "no-session" when sessionId is null', () => {
    const dir = getAgentTempDir(2097).replace(/\\/g, '/');
    expect(dir).toBe('/custom/data/agent-temp/task-2097/no-session');
  });

  test('isolates concurrent sessions for the same task', () => {
    const a = getAgentTempDir(2097, 1);
    const b = getAgentTempDir(2097, 2);
    expect(a).not.toBe(b);
  });
});

describe('agent-temp vs workflow-files location', () => {
  beforeEach(() => {
    process.env.RAPITAS_DATA_DIR = '/custom/data';
  });
  afterEach(() => {
    if (ORIGINAL_DATA_DIR === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = ORIGINAL_DATA_DIR;
  });

  test('they share the same RAPITAS_DATA_DIR root but live in separate subtrees', () => {
    const agentTemp = getAgentTempBaseDir().replace(/\\/g, '/');
    const workflows = getWorkflowBaseDir().replace(/\\/g, '/');
    expect(agentTemp).toBe('/custom/data/agent-temp');
    expect(workflows).toBe('/custom/data/workflows');
    expect(agentTemp).not.toBe(workflows);
  });

  test('workflow files for a task land in the persistent location', () => {
    const dir = getTaskWorkflowDir(1, 2, 2097).replace(/\\/g, '/');
    expect(dir).toBe('/custom/data/workflows/1/2/2097');
  });
});
