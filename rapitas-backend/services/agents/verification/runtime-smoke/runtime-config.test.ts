/**
 * runtime-config.test
 *
 * Unit tests for resolveRuntimeConfig: prefers a Theme's runtimeConfigJson
 * (managed in rapitas's own theme settings) over a rapitas.runtime.json file
 * at the workdir, only when a taskId is given and its theme has one set.
 * `prisma` is mocked (task.findUnique) — no real DB touched.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const mockTaskFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { task: { findUnique: mockTaskFindUnique } },
}));

const { resolveRuntimeConfig } = await import('./runtime-config');

const VALID_CONFIG_JSON = JSON.stringify({
  start: 'npm run dev -- -p {port}',
  url: 'http://localhost:{port}',
});

beforeEach(() => {
  mockTaskFindUnique.mockReset().mockResolvedValue(null);
});

describe('resolveRuntimeConfig', () => {
  test('falls back to the file when no taskId is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rapitas-rc-'));
    try {
      await writeFile(join(dir, 'rapitas.runtime.json'), VALID_CONFIG_JSON, 'utf8');
      const result = await resolveRuntimeConfig({ workdir: dir });
      expect(result?.config?.start).toBe('npm run dev -- -p {port}');
      expect(mockTaskFindUnique).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('falls back to the file when the task has no theme runtimeConfigJson set', async () => {
    mockTaskFindUnique.mockResolvedValue({ theme: { runtimeConfigJson: null } });
    const dir = await mkdtemp(join(tmpdir(), 'rapitas-rc-'));
    try {
      await writeFile(join(dir, 'rapitas.runtime.json'), VALID_CONFIG_JSON, 'utf8');
      const result = await resolveRuntimeConfig({ workdir: dir, taskId: 1 });
      expect(result?.config?.start).toBe('npm run dev -- -p {port}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('prefers the theme runtimeConfigJson over the file when both are present', async () => {
    mockTaskFindUnique.mockResolvedValue({
      theme: {
        runtimeConfigJson: JSON.stringify({
          start: 'npm run dev:db -- -p {port}',
          url: 'http://localhost:{port}',
        }),
      },
    });
    const dir = await mkdtemp(join(tmpdir(), 'rapitas-rc-'));
    try {
      await writeFile(join(dir, 'rapitas.runtime.json'), VALID_CONFIG_JSON, 'utf8');
      const result = await resolveRuntimeConfig({ workdir: dir, taskId: 1 });
      expect(result?.config?.start).toBe('npm run dev:db -- -p {port}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('surfaces a validation error from a broken theme runtimeConfigJson without touching the file', async () => {
    mockTaskFindUnique.mockResolvedValue({ theme: { runtimeConfigJson: 'not json' } });
    const dir = await mkdtemp(join(tmpdir(), 'rapitas-rc-'));
    try {
      await writeFile(join(dir, 'rapitas.runtime.json'), VALID_CONFIG_JSON, 'utf8');
      const result = await resolveRuntimeConfig({ workdir: dir, taskId: 1 });
      expect(result?.error).toMatch(/invalid JSON/);
      expect(result?.config).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns null when neither source is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rapitas-rc-'));
    try {
      const result = await resolveRuntimeConfig({ workdir: dir, taskId: 1 });
      expect(result).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
