/**
 * pomodoro-audio tests
 *
 * jsdom does not implement the Web Audio API, so a minimal mock AudioContext
 * is installed on `window` before each test. The module under test holds its
 * AudioContext in a module-level singleton, so `closeAudioContext()` is used
 * between tests to reset it rather than re-importing the module.
 */
import { getAudioContext, closeAudioContext, playNotificationSound } from '../pomodoro-audio';

class MockGainNode {
  connect = vi.fn();
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

class MockOscillatorNode {
  connect = vi.fn();
  frequency = { value: 0 };
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  destination = {};
  createOscillator = vi.fn(() => new MockOscillatorNode());
  createGain = vi.fn(() => new MockGainNode());
  resume = vi.fn();
  close = vi.fn();
}

describe('pomodoro-audio', () => {
  beforeEach(() => {
    closeAudioContext();
    window.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    // HACK(agent): jsdom has no webkitAudioContext; deleted between tests so
    // the fallback-path test below can control its presence explicitly.
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  });

  afterEach(() => {
    closeAudioContext();
  });

  describe('getAudioContext', () => {
    it('lazily creates an AudioContext via window.AudioContext', () => {
      const ctx = getAudioContext();
      expect(ctx).toBeInstanceOf(MockAudioContext);
    });

    it('returns the same singleton instance on repeated calls', () => {
      const first = getAudioContext();
      const second = getAudioContext();
      expect(second).toBe(first);
    });

    it('falls back to webkitAudioContext when window.AudioContext is unavailable', () => {
      // @ts-expect-error -- simulating a browser without standard AudioContext
      delete window.AudioContext;
      const WebkitCtor = vi.fn(function (this: MockAudioContext) {
        Object.assign(this, new MockAudioContext());
      });
      (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = WebkitCtor;

      getAudioContext();
      expect(WebkitCtor).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeAudioContext', () => {
    it('closes the current context and clears the singleton', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      closeAudioContext();
      expect(ctx.close).toHaveBeenCalledTimes(1);

      const next = getAudioContext();
      expect(next).not.toBe(ctx);
    });

    it('is a no-op when no context has been created yet', () => {
      expect(() => closeAudioContext()).not.toThrow();
    });
  });

  describe('playNotificationSound', () => {
    it('resumes the context when suspended', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      ctx.state = 'suspended';
      playNotificationSound('work');
      expect(ctx.resume).toHaveBeenCalledTimes(1);
    });

    it('does not resume an already-running context', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      ctx.state = 'running';
      playNotificationSound('work');
      expect(ctx.resume).not.toHaveBeenCalled();
    });

    it('plays three ascending beeps for type "work"', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      playNotificationSound('work');
      expect(ctx.createOscillator).toHaveBeenCalledTimes(3);
      const oscillators = ctx.createOscillator.mock.results.map(
        (r) => r.value as MockOscillatorNode,
      );
      expect(oscillators.every((o) => o.frequency.value === 880)).toBe(true);
      expect(oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true);
    });

    it('plays two descending beeps for type "break"', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      playNotificationSound('break');
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
      const oscillators = ctx.createOscillator.mock.results.map(
        (r) => r.value as MockOscillatorNode,
      );
      expect(oscillators[0].frequency.value).toBe(660);
      expect(oscillators[1].frequency.value).toBe(523);
    });

    it('clamps volume above 1 down to 1', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      playNotificationSound('work', 5);
      const gain = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it('clamps volume at/below 0 up to the 0.01 floor', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      playNotificationSound('work', 0);
      const gain = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.01, expect.any(Number));
    });

    it('defaults volume to 0.5 when not provided', () => {
      const ctx = getAudioContext() as unknown as MockAudioContext;
      playNotificationSound('work');
      const gain = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
    });
  });
});
