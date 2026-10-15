/**
 * pomodoro-float-launcher.test
 *
 * Verifies the launcher no-ops outside Tauri and invokes focus_pomodoro_float
 * inside Tauri.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIsTauri = vi.fn();
vi.mock('@/utils/tauri', () => ({ isTauri: () => mockIsTauri() }));

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

import { openPomodoroFloatWindow } from '../pomodoro-float-launcher';

describe('openPomodoroFloatWindow', () => {
  beforeEach(() => {
    mockIsTauri.mockReset();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('does not invoke anything outside Tauri', async () => {
    mockIsTauri.mockReturnValue(false);
    await openPomodoroFloatWindow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes focus_pomodoro_float inside Tauri', async () => {
    mockIsTauri.mockReturnValue(true);
    await openPomodoroFloatWindow();
    expect(mockInvoke).toHaveBeenCalledWith('focus_pomodoro_float');
  });

  it('swallows invoke rejection without throwing', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('window error'));
    await expect(openPomodoroFloatWindow()).resolves.toBeUndefined();
  });
});
