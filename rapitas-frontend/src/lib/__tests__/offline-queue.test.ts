import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Minimal in-memory fake of the subset of IndexedDB that offline-queue.ts
 * uses (open/onupgradeneeded/transaction/objectStore add|getAll|delete|put|clear).
 * jsdom does not implement IndexedDB, and no fake-indexeddb package is
 * installed, so this hand-rolled fake stands in for it.
 */
class FakeIDBRequest {
  result: unknown = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

function createFakeIndexedDB() {
  const storeData = new Map<number, Record<string, unknown>>();
  let nextId = 1;
  let storeCreated = false;

  const store = {
    add(value: Record<string, unknown>) {
      const req = new FakeIDBRequest();
      const id = nextId++;
      const record = { ...value, id };
      storeData.set(id, record);
      queueMicrotask(() => {
        req.result = id;
        req.onsuccess?.();
      });
      return req;
    },
    getAll() {
      const req = new FakeIDBRequest();
      queueMicrotask(() => {
        req.result = Array.from(storeData.values());
        req.onsuccess?.();
      });
      return req;
    },
    delete(id: number) {
      const req = new FakeIDBRequest();
      storeData.delete(id);
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    put(value: Record<string, unknown>) {
      const req = new FakeIDBRequest();
      storeData.set(value.id as number, value);
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    clear() {
      const req = new FakeIDBRequest();
      storeData.clear();
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };

  const database = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => {
      storeCreated = true;
      return store;
    },
    transaction: () => ({ objectStore: () => store }),
  };

  return {
    open() {
      const req = new FakeIDBRequest();
      queueMicrotask(() => {
        req.result = database;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    __storeData: storeData,
  };
}

type OfflineQueueModule = typeof import('../offline-queue');

async function freshModule(): Promise<{
  mod: OfflineQueueModule;
  fakeDB: ReturnType<typeof createFakeIndexedDB>;
}> {
  vi.resetModules();
  const fakeDB = createFakeIndexedDB();
  vi.stubGlobal('indexedDB', fakeDB);
  const mod = await import('../offline-queue');
  return { mod, fakeDB };
}

describe('offline-queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('enqueueMutation / getPendingMutations', () => {
    it('stores a mutation and returns it via getPendingMutations', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/tasks/1', 'PATCH', { 'x-a': '1' }, '{"a":1}', 'update task');

      const pending = await mod.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        url: '/tasks/1',
        method: 'PATCH',
        headers: { 'x-a': '1' },
        body: '{"a":1}',
        description: 'update task',
        retryCount: 0,
      });
      expect(pending[0].id).toBeTypeOf('number');
    });

    it('accumulates multiple mutations in order', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      await mod.enqueueMutation('/b', 'POST', {}, null, 'b');

      const pending = await mod.getPendingMutations();
      expect(pending.map((m) => m.url)).toEqual(['/a', '/b']);
    });
  });

  describe('getQueueStatus', () => {
    it('reflects pendingCount from the queue', async () => {
      const { mod } = await freshModule();
      expect((await mod.getQueueStatus()).pendingCount).toBe(0);

      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      expect((await mod.getQueueStatus()).pendingCount).toBe(1);
    });

    it('starts with isSyncing false and null timestamps', async () => {
      const { mod } = await freshModule();
      const status = await mod.getQueueStatus();
      expect(status.isSyncing).toBe(false);
      expect(status.lastSyncAt).toBeNull();
      expect(status.lastError).toBeNull();
    });

    it('falls back to safe defaults when reading the DB fails', async () => {
      vi.resetModules();
      vi.stubGlobal('indexedDB', {
        open() {
          const req = new FakeIDBRequest();
          queueMicrotask(() => req.onerror?.());
          return req;
        },
      });
      const mod = await import('../offline-queue');

      const status = await mod.getQueueStatus();

      expect(status).toEqual({
        pendingCount: 0,
        isSyncing: false,
        lastSyncAt: null,
        lastError: null,
      });
    });
  });

  describe('clearQueue', () => {
    it('removes all pending mutations', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      await mod.enqueueMutation('/b', 'POST', {}, null, 'b');

      await mod.clearQueue();

      expect(await mod.getPendingMutations()).toHaveLength(0);
    });

    it('notifies subscribers', async () => {
      const { mod } = await freshModule();
      const listener = vi.fn();
      mod.subscribeToQueue(listener);

      await mod.clearQueue();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('subscribeToQueue', () => {
    it('stops notifying after unsubscribe', async () => {
      const { mod } = await freshModule();
      const listener = vi.fn();
      const unsubscribe = mod.subscribeToQueue(listener);

      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      await mod.enqueueMutation('/b', 'POST', {}, null, 'b');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('syncQueue', () => {
    it('removes a mutation and counts success on 2xx response', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const count = await mod.syncQueue();

      expect(count).toBe(1);
      expect(await mod.getPendingMutations()).toHaveLength(0);
    });

    it('removes a mutation on 4xx without counting it as success', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

      const count = await mod.syncQueue();

      expect(count).toBe(0);
      expect(await mod.getPendingMutations()).toHaveLength(0);
    });

    it('keeps a mutation and increments retryCount on 5xx below MAX_RETRIES', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      await mod.syncQueue();

      const pending = await mod.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].retryCount).toBe(1);
    });

    it('discards a mutation once retryCount reaches MAX_RETRIES (5) on repeated 5xx', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      // MAX_RETRIES = 5: sync 6 times to push retryCount from 0 -> 5, then discard.
      for (let i = 0; i < 6; i++) {
        await mod.syncQueue();
      }

      expect(await mod.getPendingMutations()).toHaveLength(0);
    });

    it('stops processing and preserves the mutation on a network error', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      await mod.enqueueMutation('/b', 'POST', {}, null, 'b');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const count = await mod.syncQueue();

      expect(count).toBe(0);
      // Both mutations remain — the loop breaks on the first network failure.
      expect(await mod.getPendingMutations()).toHaveLength(2);
      expect((await mod.getQueueStatus()).lastError).toBeNull();
    });

    it('returns 0 immediately if a sync is already in progress', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      let resolveFetch: (v: { ok: boolean; status: number }) => void = () => {};
      vi.stubGlobal(
        'fetch',
        vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
        ),
      );

      const firstSync = mod.syncQueue();
      // A second call while the first is still in-flight should short-circuit.
      const secondResult = await mod.syncQueue();

      expect(secondResult).toBe(0);
      resolveFetch({ ok: true, status: 200 });
      await firstSync;
    });
  });

  describe('offlineFetch', () => {
    it('passes GET requests straight through to fetch without queuing', async () => {
      const { mod } = await freshModule();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const res = await mod.offlineFetch('/tasks', { method: 'GET' });

      expect(fetchMock).toHaveBeenCalledWith('/tasks', { method: 'GET' });
      expect(res.ok).toBe(true);
      expect(await mod.getPendingMutations()).toHaveLength(0);
    });

    it('returns the response directly when the mutation succeeds', async () => {
      const { mod } = await freshModule();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const res = await mod.offlineFetch('/tasks/1', { method: 'PATCH', body: '{}' });

      expect(res.ok).toBe(true);
      expect(await mod.getPendingMutations()).toHaveLength(0);
    });

    it('queues the mutation and returns a synthetic 202 on network failure while offline', async () => {
      const { mod } = await freshModule();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      const res = await mod.offlineFetch(
        'https://api.test/tasks/1',
        { method: 'PATCH', body: '{"a":1}' },
        'update task 1',
      );

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.queued).toBe(true);

      const pending = await mod.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        url: 'https://api.test/tasks/1',
        method: 'PATCH',
        description: 'update task 1',
      });
    });

    it('extracts headers from a Headers instance when queuing', async () => {
      const { mod } = await freshModule();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      const headers = new Headers({ 'x-test': 'yes' });
      await mod.offlineFetch('https://api.test/tasks/2', { method: 'POST', headers, body: '{}' });

      const pending = await mod.getPendingMutations();
      expect(pending[0].headers['x-test']).toBe('yes');
    });

    it('extracts headers from an array-of-tuples format when queuing', async () => {
      const { mod } = await freshModule();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      await mod.offlineFetch('https://api.test/tasks/4', {
        method: 'POST',
        headers: [['x-test', 'array-value']],
        body: '{}',
      });

      const pending = await mod.getPendingMutations();
      expect(pending[0].headers['x-test']).toBe('array-value');
    });

    it('extracts headers from a plain object when queuing', async () => {
      const { mod } = await freshModule();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      await mod.offlineFetch('https://api.test/tasks/5', {
        method: 'POST',
        headers: { 'x-test': 'plain-value' },
        body: '{}',
      });

      const pending = await mod.getPendingMutations();
      expect(pending[0].headers['x-test']).toBe('plain-value');
    });

    it('re-throws non-network errors instead of queuing', async () => {
      const { mod } = await freshModule();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

      await expect(
        mod.offlineFetch('https://api.test/tasks/3', { method: 'POST', body: '{}' }),
      ).rejects.toThrow('boom');
      expect(await mod.getPendingMutations()).toHaveLength(0);
    });
  });

  describe('auto-sync on browser online event', () => {
    it('automatically syncs the queue when the browser comes back online', async () => {
      const { mod } = await freshModule();
      await mod.enqueueMutation('/a', 'POST', {}, null, 'a');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      window.dispatchEvent(new Event('online'));
      // Let the queued microtask-based syncQueue() chain (fake IDB reads +
      // mocked fetch + removeMutation) fully settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await mod.getPendingMutations()).toHaveLength(0);
    });
  });
});
