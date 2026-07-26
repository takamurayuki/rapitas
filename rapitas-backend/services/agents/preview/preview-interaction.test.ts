/**
 * preview-interaction.test
 *
 * Unit tests for interactWithPreview/inspectPreviewElement: dispatch to the
 * right worker method per action, not_active when no session exists, and
 * error surfacing when the worker call rejects. The `sessions` map is
 * mocked directly (via preview-session-manager) with a fake worker so no
 * real dev server/browser is ever touched.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockClick = mock(() => Promise.resolve());
const mockType = mock(() => Promise.resolve());
const mockPressKey = mock(() => Promise.resolve());
const mockScroll = mock(() => Promise.resolve());
const mockSelectOption = mock(() => Promise.resolve());
const mockInspectSelect = mock(() => Promise.resolve({ isSelect: false }));

const fakeWorker = {
  click: mockClick,
  type: mockType,
  pressKey: mockPressKey,
  scroll: mockScroll,
  selectOption: mockSelectOption,
  inspectSelect: mockInspectSelect,
};

const sessions = new Map<number, { worker: typeof fakeWorker; lastAccessedAt: Date }>();

mock.module('./preview-session-manager', () => ({ sessions }));

const { interactWithPreview, inspectPreviewElement } = await import('./preview-interaction');

function resetMocks() {
  for (const m of [mockClick, mockType, mockPressKey, mockScroll, mockSelectOption]) m.mockReset();
  mockInspectSelect.mockReset();
  mockClick.mockResolvedValue(undefined);
  mockType.mockResolvedValue(undefined);
  mockPressKey.mockResolvedValue(undefined);
  mockScroll.mockResolvedValue(undefined);
  mockSelectOption.mockResolvedValue(undefined);
  mockInspectSelect.mockResolvedValue({ isSelect: false });
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

describe('inspectPreviewElement', () => {
  beforeEach(resetMocks);

  it('returns not_active when the task has no session', async () => {
    const result = await inspectPreviewElement(999, 1, 2);
    expect(result).toEqual({ ok: false, reason: 'not_active' });
  });

  it('returns the worker inspection merged with ok:true', async () => {
    mockInspectSelect.mockResolvedValue({
      isSelect: true,
      value: 'a',
      options: [{ value: 'a', label: 'A', selected: true }],
    });
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });

    const result = await inspectPreviewElement(42, 10, 20);

    expect(result).toEqual({
      ok: true,
      isSelect: true,
      value: 'a',
      options: [{ value: 'a', label: 'A', selected: true }],
    });
    expect(mockInspectSelect).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('surfaces a rejecting worker call as an error result', async () => {
    mockInspectSelect.mockRejectedValue(new Error('worker gone'));
    sessions.set(42, { worker: fakeWorker, lastAccessedAt: new Date(0) });

    const result = await inspectPreviewElement(42, 1, 2);

    expect(result).toEqual({ ok: false, reason: 'error', message: 'worker gone' });
  });
});
