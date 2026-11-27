/**
 * companion-entry.resource-gate.test
 *
 * Task 1553: the same-theme companion path (2nd and later task of a theme)
 * used to bypass the resource-contention gate entirely. It must now ask the
 * gate first, with the theme's running count, and skip companion selection
 * when the gate holds.
 *
 * Run this file on its own: bun's mock.module is process-global.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let running: number[] = [7];
mock.module('../theme-active-set', () => ({
  MAX_CAS_ATTEMPTS: 3,
  model: () => ({}),
  casUpdate: async () => true,
  parseCompanions: () => [],
  serializeCompanions: () => '[]',
  readThemeActiveSet: async () => ({}),
  loadThemeActiveSet: async () => ({}),
  activeTaskIds: () => running,
  addCompanion: async () => true,
  releaseThemeSlot: async () => 'not_member',
  retrackThemeSlot: async () => {},
}));

mock.module('../../auto-run-concurrency', () => ({
  resolveAutoRunMaxConcurrencyPerTheme: async () => ({ effective: 2 }),
}));

const gateMock = mock(async (_p: unknown, _themeId: number, _active: number) => false);
mock.module('../../auto-run-advance-gates', () => ({
  checkResourceContentionGate: gateMock,
  checkCalendarSlotGate: mock(async () => false),
  checkMergeBarrierGate: mock(() => false),
}));

const selectCompanionMock = mock(async () => ({ selected: false }));
mock.module('../companion-selection', () => ({
  selectCompanionTask: selectCompanionMock,
}));

const { delegateToCompanionSelection } = await import('../companion-entry');
const prisma = {} as Parameters<typeof delegateToCompanionSelection>[0];

beforeEach(() => {
  running = [7];
  gateMock.mockReset();
  gateMock.mockImplementation(async () => false);
  selectCompanionMock.mockClear();
});

afterAll(() => mock.restore());

describe('delegateToCompanionSelection — resource gate (task 1553)', () => {
  it('holds: skips companion selection but still reports the call as handled', async () => {
    gateMock.mockImplementation(async () => true);
    expect(await delegateToCompanionSelection(prisma, 3, 'priority')).toBe(true);
    expect(gateMock).toHaveBeenCalledTimes(1);
    expect(gateMock.mock.calls[0]![1]).toBe(3);
    expect(gateMock.mock.calls[0]![2]).toBe(1); // the theme's running count
    expect(selectCompanionMock).not.toHaveBeenCalled();
  });

  it('does not hold: proceeds to companion selection', async () => {
    expect(await delegateToCompanionSelection(prisma, 3, 'priority')).toBe(true);
    expect(selectCompanionMock).toHaveBeenCalledTimes(1);
  });

  it('nothing running in the theme: not a companion slot, gate not consulted', async () => {
    running = [];
    expect(await delegateToCompanionSelection(prisma, 3, 'priority')).toBe(false);
    expect(gateMock).not.toHaveBeenCalled();
  });
});
