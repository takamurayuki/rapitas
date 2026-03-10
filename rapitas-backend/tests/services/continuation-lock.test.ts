/**
 * 継続実行ロック機能のテスト
 *
 * executeContinuationの重複実行防止機能をテスト
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ロック機能をテストするためのモッククラス
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
      // ユーザー応答が先にロックを取得
      const userResult = lockManager.tryAcquireLock(1, 'user_response');
      expect(userResult).toBe(true);

      // タイムアウトハンドラがロック取得を試みる（失敗すべき）
      const timeoutResult = lockManager.tryAcquireLock(1, 'auto_timeout');
      expect(timeoutResult).toBe(false);

      // ロックの所有者はuser_response
      const info = lockManager.getLockInfo(1);
      expect(info?.source).toBe('user_response');
    });

    it('タイムアウトがユーザー応答より先にロックを取得', () => {
      // タイムアウトハンドラが先にロックを取得
      const timeoutResult = lockManager.tryAcquireLock(1, 'auto_timeout');
      expect(timeoutResult).toBe(true);

      // ユーザー応答がロック取得を試みる（失敗すべき）
      const userResult = lockManager.tryAcquireLock(1, 'user_response');
      expect(userResult).toBe(false);

      // ロックの所有者はauto_timeout
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
  // タイムアウト処理のシミュレーション
  class TimeoutSimulator {
    private activeTimeouts: Map<number, NodeJS.Timeout> = new Map();
    private lockManager: ContinuationLockManager;
    private executedCallbacks: Array<{ executionId: number; source: string }> = [];

    constructor(lockManager: ContinuationLockManager) {
      this.lockManager = lockManager;
    }

    startTimeout(executionId: number, delayMs: number): void {
      const timer = setTimeout(async () => {
        // ロックを取得してからコールバックを実行
        if (this.lockManager.tryAcquireLock(executionId, 'auto_timeout')) {
          this.executedCallbacks.push({ executionId, source: 'auto_timeout' });
          // 処理完了後にロックを解放
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
      // まずタイムアウトをキャンセル
      this.cancelTimeout(executionId);

      // ロックを取得
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

    // タイムアウトを開始（100ms後に発火）
    simulator.startTimeout(1, 100);

    // すぐにユーザー応答（タイムアウト前）
    const result = await simulator.simulateUserResponse(1);
    expect(result).toBe(true);

    // タイムアウトの発火時間を待つ
    await new Promise((resolve) => setTimeout(resolve, 150));

    // コールバックは1回のみ（user_responseのみ）
    const callbacks = simulator.getExecutedCallbacks();
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].source).toBe('user_response');
  });

  it('タイムアウト発火後のユーザー応答は処理される', async () => {
    const lockManager = new ContinuationLockManager();
    const simulator = new TimeoutSimulator(lockManager);

    // タイムアウトを開始（10ms後に発火）
    simulator.startTimeout(1, 10);

    // タイムアウト発火を待つ
    await new Promise((resolve) => setTimeout(resolve, 50));

    // タイムアウト後のユーザー応答
    const result = await simulator.simulateUserResponse(1);
    expect(result).toBe(true);

    // 両方のコールバックが実行される（順番に）
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
      // エラーは無視
    }

    // ロックは解放されているはず
    expect(lockManager.hasLock(executionId)).toBe(false);

    // 新しいロック取得が可能
    const result = lockManager.tryAcquireLock(executionId, 'auto_timeout');
    expect(result).toBe(true);
  });
});
