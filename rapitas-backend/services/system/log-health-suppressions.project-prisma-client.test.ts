/**
 * log-health-suppressions.project-prisma-client.test
 *
 * Pins the suppression of the projectPrismaClient "prisma:generate failed" WARN
 * (task #1304, EPERM on the locked query engine DLL) while keeping other WARNs visible.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

const LOGGER = 'git-operations/project-prisma-client';
const RAW = [
  'Command failed: pnpm run prisma:generate',
  '$ cd rapitas-backend && npx prisma generate',
  'npm notice run npx',
  'npm notice run prisma generate',
  'Loaded Prisma config from prisma.config.ts.',
  '',
  'Prisma config detected, skipping environment variable loading.',
  'Error: ',
  "EPERM: operation not permitted, rename 'C:\\Projects\\rapitas\\rapitas-backend\\generated\\prisma-sqlite\\query_engine-windows.dll.node.tmp22860' -> 'C:\\Projects\\rapitas\\rapitas-backend\\generated\\prisma-sqlite\\query_engine-windows.dll.node'",
].join('\n');

describe('projectPrismaClient prisma:generate failure WARN', () => {
  test('is suppressed after normalization for the prisma-client logger', () => {
    const v = classifyLogSignature(LOGGER, normalizeMessage(RAW));
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('is scoped to the prisma-client logger only', () => {
    expect(classifyLogSignature('some-other-logger', normalizeMessage(RAW)).suppressed).toBe(false);
  });

  test('other WARNs of the same logger stay visible', () => {
    for (const other of [
      '[projectPrismaClient] Could not record the generate fingerprint',
      'Dependency install failed',
    ]) {
      expect(classifyLogSignature(LOGGER, normalizeMessage(other)).suppressed).toBe(false);
    }
  });
});
