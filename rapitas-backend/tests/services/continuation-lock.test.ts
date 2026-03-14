/**
 * Continuation Execution Lock Test
 *
 * Tests the duplicate execution prevention mechanism of executeContinuation.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock class for testing the lock mechanism
class ContinuationLockManager {
  private locks: Map<number, { source: string; lockedAt: Date }> = new Map();

  tryAcquireLock(executionId: number, source: string): boolean {
    if (this.locks.has(executionId)) {
      return false;
    }
    this.locks.set(executionId, {
      source,
      lockedAt: new Date(),
    });
    return true;
  }

  releaseLock(executionId: number): void {
    this.locks.delete(executionId);
  }

  hasLock(executionId: number): boolean {
    return this.locks.has(executionId);
  }

  getLockInfo(executionId: number): { source: string; lockedAt: Date } | null {
    return this.locks.get(executionId) || null;
  }
}

describe('継続実行ロック機能', () => {
  let lockManager: ContinuationLockManager;

  beforeEach(() => {
    lockManager = new ContinuationLockManager();
  });

  describe('ロック取得', () => {
    it('最初のロック取得は成功する', () => {
      const result = lockManager.tryAcquireLock(1, 'user_response');
      expect(result).toBe(true);
      expect(lockManager.hasLock(1)).toBe(true);
    });

    it('同じexecutionIdへの重複ロック取得は失敗する', () => {
      lockManager.tryAcquireLock(1, 'user_response');
      const result = lockManager.tryAcquireLock(1, 'auto_timeout');
      expect(result).toBe(false);
    });

    it('異なるexecutionIdへのロック取得は成功する', () => {
      lockManager.tryAcquireLock(1, 'user_response');
      const result = lockManager.tryAcquireLock(2, 'user_response');
      expect(result).toBe(true);
    });

    it('ロック情報にソースが記録される', () => {
      lockManager.tryAcquireLock(1, 'user_response');
      const info = lockManager.getLockInfo(1);
      expect(info?.source).toBe('user_response');
    });

    it('ロック情報に時刻が記録される', () => {
      const before = new Date();
      lockManager.tryAcquireLock(1, 'user_response');
      const after = new Date();
      const info = lockManager.getLockInfo(1);
      expect(info?.lockedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(info?.lockedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('ロック解放', () => {
    it('ロックを解放するとhasLockがfalseを返す', () => {
      lockManager.tryAcquireLock(1, 'user_response');
      lockManager.releaseLock(1);
      expect(lockManager.hasLock(1)).toBe(false);
    });

    it('ロック解放後に再取得が可能', () => {
      lockManager.tryAcquireLock(1, 'user_response');
      lockManager.releaseLock(1);
      const result = lockManager.tryAcquireLock(1, 'auto_timeout');
      expect(result).toBe(true);
    });

    it('存在しないロックの解放はエラーにならない', () => {
      expect(() => lockManager.releaseLock(999)).not.toThrow();
    });
  });

  describe('競合シナリオ', () => {
    it('ユーザー応答がタイムアウトより先にロックを取得', () => {
      // User response acquires the lock first
      const userResult = lockManager.tryAcquireLock(1, 'user_response');
      expect(userResult).toBe(true);

      // Timeout handler attempts to acquire the lock (should fail)
      const timeoutResult = lockManager.tryAcquireLock(1, 'auto_timeout');
      expect(timeoutResult).toBe(false);

      // Lock owner should be user_response
      const info = lockManager.getLockInfo(1);
      expect(info?.source).toBe('user_response');
    });

    it('タイムアウトがユーザー応答より先にロックを取得', () => {
      // Timeout handler acquires the lock first
      const timeoutResult = lockManager.tryAcquireLock(1, 'auto_timeout');
      expect(timeoutResult).toBe(true);

      // User response attempts to acquire the lock (should fail)
      const userResult = lockManager.tryAcquireLock(1, 'user_response');
      expect(userResult).toBe(false);

      // Lock owner should be auto_timeout
      const info = lockManager.getLockInfo(1);
      expect(info?.source).toBe('auto_timeout');
    });

    it('複数の実行が独立してロックを管理', () => {
      lockManager.tryAcquireLock(1, 'user_response');
      lockManager.tryAcquireLock(2, 'auto_timeout');
      lockManager.tryAcquireLock(3, 'user_response');

      expect(lockManager.hasLock(1)).toBe(true);
      expect(lockManager.hasLock(2)).toBe(true);
      expect(lockManager.hasLock(3)).toBe(true);

      lockManager.releaseLock(2);
      expect(lockManager.hasLock(1)).toBe(true);
      expect(lockManager.hasLock(2)).toBe(false);
      expect(lockManager.hasLock(3)).toBe(true);
    });
  });
});

describe('タイムアウト処理の競合防止', () => {
  // Timeout processing simulation
  class TimeoutSimulator {
    private activeTimeouts: Map<number, NodeJS.Timeout> = new Map();
    private lockManager: ContinuationLockManager;
    private executedCallbacks: Array<{ executionId: number; source: string }> = [];

    constructor(lockManager: ContinuationLockManager) {
      this.lockManager = lockManager;
    }

    startTimeout(executionId: number, delayMs: number): void {
      const timer = setTimeout(async () => {
        // Acquire lock before executing callback
        if (this.lockManager.tryAcquireLock(executionId, 'auto_timeout')) {
          this.executedCallbacks.push({ executionId, source: 'auto_timeout' });
          // Release lock after processing completes
          this.lockManager.releaseLock(executionId);
        }
        this.activeTimeouts.delete(executionId);
      }, delayMs);
      this.activeTimeouts.set(executionId, timer);
    }

    cancelTimeout(executionId: number): void {
      const timer = this.activeTimeouts.get(executionId);
      if (timer) {
        clearTimeout(timer);
        this.activeTimeouts.delete(executionId);
      }
    }

    async simulateUserResponse(executionId: number): Promise<boolean> {
      // Cancel timeout first
      this.cancelTimeout(executionId);

      // Acquire lock
      if (!this.lockManager.tryAcquireLock(executionId, 'user_response')) {
        return false;
      }

      this.executedCallbacks.push({ executionId, source: 'user_response' });
      this.lockManager.releaseLock(executionId);
      return true;
    }

    getExecutedCallbacks() {
      return this.executedCallbacks;
    }

    clearCallbacks() {
      this.executedCallbacks = [];
    }
  }

  it('ユーザー応答後にタイムアウトコールバックは実行されない', async () => {
    const lockManager = new ContinuationLockManager();
    const simulator = new TimeoutSimulator(lockManager);

    // Start timeout (fires after 100ms)
    simulator.startTimeout(1, 100);

    // Immediate user response (before timeout)
    const result = await simulator.simulateUserResponse(1);
    expect(result).toBe(true);

    // Wait for the timeout to fire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Only one callback should have fired (user_response only)
    const callbacks = simulator.getExecutedCallbacks();
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].source).toBe('user_response');
  });

  it('タイムアウト発火後のユーザー応答は処理される', async () => {
    const lockManager = new ContinuationLockManager();
    const simulator = new TimeoutSimulator(lockManager);

    // Start timeout (fires after 10ms)
    simulator.startTimeout(1, 10);

    // Wait for timeout to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    // User response after timeout
    const result = await simulator.simulateUserResponse(1);
    expect(result).toBe(true);

    // Both callbacks should have fired (sequentially)
    const callbacks = simulator.getExecutedCallbacks();
    expect(callbacks).toHaveLength(2);
    expect(callbacks[0].source).toBe('auto_timeout');
    expect(callbacks[1].source).toBe('user_response');
  });
});

describe('エラーハンドリング', () => {
  it('例外が発生してもロックは解放される', async () => {
    const lockManager = new ContinuationLockManager();
    const executionId = 1;

    const processWithError = async () => {
      if (!lockManager.tryAcquireLock(executionId, 'user_response')) {
        throw new Error('Lock acquisition failed');
      }
      try {
        throw new Error('Processing error');
      } finally {
        lockManager.releaseLock(executionId);
      }
    };

    try {
      await processWithError();
    } catch {
      // Ignore error
    }

    // Lock should have been released
    expect(lockManager.hasLock(executionId)).toBe(false);

    // A new lock acquisition should succeed
    const result = lockManager.tryAcquireLock(executionId, 'auto_timeout');
    expect(result).toBe(true);
  });
});
