/**
 * settings-extra-fields.test
 *
 * Verifies the extracted cast-write helper (pending-client-regen columns) and
 * the file-backed autoRestartOnMergedCode helper: which updates fire, the
 * verifyRepairLimit clamp, and the mirror onto the response object.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const updateCalls: Array<Record<string, unknown>> = [];
let updateFails = false;

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    userSettings: {
      update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updateCalls.push(args.data);
        return updateFails ? Promise.reject(new Error('db down')) : Promise.resolve(args.data);
      },
    },
  },
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// File-backed toggle store: in-memory stand-in.
let storedEnabled = false;
mock.module('../../../services/scheduling/auto-restart-merged-code/settings-store', () => ({
  readAutoRestartEnabled: () => storedEnabled,
  writeAutoRestartEnabled: (value: boolean) => {
    storedEnabled = value;
  },
  readLastRestartAt: () => 0,
  writeLastRestartAt: () => {},
}));

const { applyPendingClientColumns, applyAutoRestartOnMergedCode } =
  await import('../../../routes/system/settings/settings-extra-fields');

beforeEach(() => {
  updateCalls.length = 0;
  updateFails = false;
  storedEnabled = false;
});

describe('applyPendingClientColumns', () => {
  test('writes nothing when no pending fields are present', async () => {
    const ref: Record<string, unknown> = {};
    await applyPendingClientColumns(1, {}, ref);
    expect(updateCalls).toEqual([]);
    expect(ref).toEqual({});
  });

  test('writes each defined field and mirrors it onto the ref', async () => {
    const ref: Record<string, unknown> = {};
    await applyPendingClientColumns(
      1,
      { restartOnAutoRunDry: true, verifyRepairLimit: 3, workflowDisabledGlobally: false },
      ref,
    );
    expect(updateCalls).toEqual([
      { restartOnAutoRunDry: true },
      { verifyRepairLimit: 3 },
      { workflowDisabledGlobally: false },
    ]);
    expect(ref).toEqual({
      restartOnAutoRunDry: true,
      verifyRepairLimit: 3,
      workflowDisabledGlobally: false,
    });
  });

  test('clamps verifyRepairLimit into 0..10', async () => {
    const ref: Record<string, unknown> = {};
    await applyPendingClientColumns(1, { verifyRepairLimit: 99 }, ref);
    expect(updateCalls).toEqual([{ verifyRepairLimit: 10 }]);
    expect(ref.verifyRepairLimit).toBe(10);
  });

  test('a failed DB write is swallowed but the ref still mirrors the value', async () => {
    updateFails = true;
    const ref: Record<string, unknown> = {};
    await applyPendingClientColumns(1, { restartOnAutoRunDry: true }, ref);
    expect(ref.restartOnAutoRunDry).toBe(true);
  });
});

describe('applyAutoRestartOnMergedCode', () => {
  test('always mirrors the current stored value even without a body field', () => {
    storedEnabled = true;
    const ref: Record<string, unknown> = {};
    applyAutoRestartOnMergedCode({}, ref);
    expect(ref.autoRestartOnMergedCode).toBe(true);
  });

  test('writes the toggle when the body carries it', () => {
    const ref: Record<string, unknown> = {};
    applyAutoRestartOnMergedCode({ autoRestartOnMergedCode: true }, ref);
    expect(storedEnabled).toBe(true);
    expect(ref.autoRestartOnMergedCode).toBe(true);
  });

  test('turns the toggle off', () => {
    storedEnabled = true;
    const ref: Record<string, unknown> = {};
    applyAutoRestartOnMergedCode({ autoRestartOnMergedCode: false }, ref);
    expect(storedEnabled).toBe(false);
    expect(ref.autoRestartOnMergedCode).toBe(false);
  });
});
