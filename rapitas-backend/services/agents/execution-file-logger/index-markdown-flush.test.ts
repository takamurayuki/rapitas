/**
 * ExecutionFileLogger.flush — companion Markdown outline.
 *
 * Verifies the heading-structured .md is written next to the .log and keeps the h2→h3 contract.
 */
import { describe, test, expect, mock } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

const { ExecutionFileLogger } = await import('./index');
const { validateHeadingContinuity } = await import('./log-markdown-builder');

describe('flush writes a Markdown outline', () => {
  test('exec-*.md sits beside the .log and passes continuity validation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efl-md-'));
    try {
      const logger = new ExecutionFileLogger(9, 1, 1, 'task', 'test', undefined, undefined, {
        logDir: dir,
        enableConsolePassthrough: false,
      });
      logger.logExecutionStart('run', {});
      logger.logExecutionEnd('completed');
      const logPath = await logger.flush();
      expect(logPath).not.toBeNull();

      const files = await readdir(dir);
      const md = files.find((f) => f.endsWith('.md'));
      expect(md).toBe(path.basename(logPath as string).replace(/\.log$/, '.md'));
      const body = await readFile(path.join(dir, md as string), 'utf-8');
      expect(validateHeadingContinuity(body)).toEqual([]);
      expect(body).toMatch(/^## /m);
      expect(body).toContain('- ref: execution 9');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
