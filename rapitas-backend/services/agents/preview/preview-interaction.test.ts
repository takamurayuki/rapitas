/**
 * preview-interaction.test
 *
 * Unit tests for interactWithPreview/clickPreview: dispatch to the right
 * worker method per action, not_active when no session exists, and error
 * surfacing when the worker call rejects. The `sessions` map is mocked
 * directly (via preview-session-manager) with a fake worker so no real dev
 * server/browser is ever touched.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockClick = mock(() => Promise.resolve());
const mockType = mock(() => Promise.resolve());
const mockPressKey = mock(() => Promise.resolve());
const mockScroll = mock(() => Promise.resolve());
const mockSelectOption = mock(() => Promise.resolve());
const mockInspectSelect = mock(() => Promise.resolve({ isSelect: false }));
const mockScreenshot = mock(() => Promise.resolve(Buffer.from([9, 9, 9])));

const fakeWorker = {
  click: mockClick,
  type: mockType,
  pressKey: mockPressKey,
  scroll: mockScroll,
  selectOption: mockSelectOption,
  inspectSelect: mockInspectSelect,
  screenshot: mockScreenshot,
};

const sessions = new Map<number, { worker: typeof fakeWorker; lastAccessedAt: Date }>();

mock.module('./preview-session-manager', () => ({ sessions }));

const { interactWithPreview, clickPreview } = await import('./preview-interaction');

function resetMocks() {
  for (const m of [mockClick, mockType, mockPressKey, mockScroll, mockSelectOption]) m.mockReset();
  mockInspectSelect.mockReset();
  mockScreenshot.mockReset();
  mockClick.mockResolvedValue(undefined);
  mockType.mockResolvedValue(undefined);
  mockPressKey.mockResolvedValue(undefined);
  mockScroll.mockResolvedValue(undefined);
  mockSelectOption.mockResolvedValue(undefined);
  mockInspectSelect.mockResolvedValue({ isSelect: false });
  mockScreenshot.mockResolvedValue(Buffer.from([9, 9, 9]));
  sessions.clear();
}

describe('interactWithPreview', () => {
  beforeEach(resetMocks);

  it('returns not_active when the task has no session', async () => {
    const result = await interactWithPreview(999, { action: 'click', x: 1, y: 2 });
    expect(result).toEqual({ ok: false, reason: 'not_active' });
  });

  it.each([
    {
      interaction: { action: 'click' as const, x: 10, y: 20 },
      mockFn: mockClick,
      expectedArgs: { x: 10, y: 20 },
    },
    {
      interaction: { action: 'type' as const, text: 'hello' },
      mockFn: mockType,
      expectedArgs: { text: 'hello' },
    },
    {
      interaction: { action: 'key' as const, key: 'Enter' },
      mockFn: mockPressKey,
      expectedArgs: { key: 'Enter' },
    },
    {
      interaction: { action: 'scroll' as const, deltaX: 1, deltaY: 2 },
      mockFn: mockScroll,
      expectedArgs: { deltaX: 1, deltaY: 2 },
    },
    {
      interaction: { action: 'select' as const, x: 5, y: 6, value: 'opt1' },
      mockFn: mockSelectOption,
      expectedArgs: { x: 5, y: 6, value: 'opt1' },
    },
  ])(
    'dispatches $interaction.action to the matching worker method',
    async ({ interaction, mockFn, expectedArgs }) => {
      sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });
      const result = await interactWithPreview(42, interaction);
      expect(result).toEqual({ ok: true });
      expect(mockFn).toHaveBeenCalledWith(expectedArgs);
    },
  );

  it('bumps lastAccessedAt on a successful interaction', async () => {
    const session = { worker: fakeWorker, lastAccessedAt: new Date(0) };
    sessions.set(42, session);
    await interactWithPreview(42, { action: 'click', x: 1, y: 1 });
    expect(session.lastAccessedAt.getTime()).toBeGreaterThan(0);
  });

  it('surfaces a rejecting worker call as an error result', async () => {
    mockClick.mockRejectedValue(new Error('boom'));
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });
    const result = await interactWithPreview(42, { action: 'click', x: 1, y: 1 });
    expect(result).toEqual({ ok: false, reason: 'error', message: 'boom' });
  });
});

describe('clickPreview', () => {
  beforeEach(resetMocks);

  it('returns not_active when the task has no session', async () => {
    const result = await clickPreview(999, 1, 2);
    expect(result).toEqual({ ok: false, reason: 'not_active' });
  });

  it('returns select details WITHOUT clicking or screenshotting when the point is a <select>', async () => {
    mockInspectSelect.mockResolvedValue({
      isSelect: true,
      value: 'a',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      options: [{ value: 'a', label: 'A', selected: true, disabled: false }],
    });
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });

    const result = await clickPreview(42, 10, 20);

    expect(result).toEqual({
      ok: true,
      isSelect: true,
      value: 'a',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      options: [{ value: 'a', label: 'A', selected: true, disabled: false }],
    });
    expect(mockInspectSelect).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(mockClick).not.toHaveBeenCalled();
    expect(mockScreenshot).not.toHaveBeenCalled();
  });

  it('relays the click and returns a fresh screenshot when the point is not a <select>', async () => {
    mockInspectSelect.mockResolvedValue({ isSelect: false });
    mockScreenshot.mockResolvedValue(Buffer.from([7, 8, 9]));
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });

    const result = await clickPreview(42, 10, 20);

    expect(mockClick).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(result).toEqual({ ok: true, isSelect: false, buffer: Buffer.from([7, 8, 9]) });
  });

  it('bumps lastAccessedAt on a successful click', async () => {
    const session = { worker: fakeWorker, lastAccessedAt: new Date(0) };
    sessions.set(42, session);
    await clickPreview(42, 1, 1);
    expect(session.lastAccessedAt.getTime()).toBeGreaterThan(0);
  });

  it('surfaces a rejecting inspect call as an error result', async () => {
    mockInspectSelect.mockRejectedValue(new Error('worker gone'));
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });

    const result = await clickPreview(42, 1, 2);

    expect(result).toEqual({ ok: false, reason: 'error', message: 'worker gone' });
  });

  it('surfaces a rejecting click call as an error result', async () => {
    mockInspectSelect.mockResolvedValue({ isSelect: false });
    mockClick.mockRejectedValue(new Error('click failed'));
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });

    const result = await clickPreview(42, 1, 2);

    expect(result).toEqual({ ok: false, reason: 'error', message: 'click failed' });
  });
});
