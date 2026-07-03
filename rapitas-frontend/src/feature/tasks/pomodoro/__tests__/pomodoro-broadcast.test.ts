/**
 * pomodoro-broadcast tests
 *
 * jsdom does not implement BroadcastChannel, so a minimal mock class is
 * installed on `window` before each test. The module holds its channel in a
 * module-level singleton, so `closeBroadcastChannel()` resets it between
 * tests instead of re-importing the module.
 */
import { getBroadcastChannel, closeBroadcastChannel, broadcastState } from '../pomodoro-broadcast';

class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();

  constructor(name: string) {
    this.name = name;
  }
}

describe('pomodoro-broadcast', () => {
  beforeEach(() => {
    closeBroadcastChannel();
    window.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    closeBroadcastChannel();
  });

  describe('getBroadcastChannel', () => {
    it('lazily creates a channel named "pomodoro-sync"', () => {
      const channel = getBroadcastChannel() as unknown as MockBroadcastChannel;
      expect(channel.name).toBe('pomodoro-sync');
    });

    it('returns the same singleton instance on repeated calls', () => {
      const first = getBroadcastChannel();
      const second = getBroadcastChannel();
      expect(second).toBe(first);
    });
  });

  describe('closeBroadcastChannel', () => {
    it('closes the channel and clears the singleton', () => {
      const channel = getBroadcastChannel() as unknown as MockBroadcastChannel;
      closeBroadcastChannel();
      expect(channel.close).toHaveBeenCalledTimes(1);

      const next = getBroadcastChannel();
      expect(next).not.toBe(channel);
    });

    it('is a no-op when no channel has been created yet', () => {
      expect(() => closeBroadcastChannel()).not.toThrow();
    });
  });

  describe('broadcastState', () => {
    it('posts a STATE_UPDATE message with the given partial state', () => {
      const channel = getBroadcastChannel() as unknown as MockBroadcastChannel;
      const partial = { isPaused: true, pomodoroSeconds: 42 };
      broadcastState(partial);
      expect(channel.postMessage).toHaveBeenCalledWith({ type: 'STATE_UPDATE', state: partial });
    });

    it('lazily creates the channel if none exists yet', () => {
      broadcastState({ isPaused: false });
      const channel = getBroadcastChannel() as unknown as MockBroadcastChannel;
      expect(channel.postMessage).toHaveBeenCalledWith({
        type: 'STATE_UPDATE',
        state: { isPaused: false },
      });
    });
  });
});
