/**
 * Offline Write Queue
 *
 * Queues failed API mutations (POST/PUT/PATCH/DELETE) in IndexedDB when
 * the network is unavailable. Automatically replays the queue when the
 * connection is restored. Provides hooks for UI feedback.
 */

const DB_NAME = 'rapitas-offline';
const STORE_NAME = 'pending-mutations';
const DB_VERSION = 1;

/** A queued mutation waiting to be sent when online. */
export interface QueuedMutation {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  createdAt: string;
  retryCount: number;
  description: string;
}

/** Queue status for UI display. */
export interface QueueStatus {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

let db: IDBDatabase | null = null;
let syncing = false;
let lastSyncAt: string | null = null;
let lastError: string | null = null;
const listeners = new Set<() => void>();

/**
 * Open the IndexedDB database.
 */
function openDb(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(new Error('Failed to open offline queue database'));
    };
  });
}

/**
 * Enqueue a failed mutation for later replay.
 *
 * @param url - API endpoint URL. / APIエンドポイントURL
 * @param method - HTTP method. / HTTPメソッド
 * @param headers - Request headers. / リクエストヘッダー
 * @param body - Request body (serialized). / リクエストボディ
 * @param description - Human-readable description for UI. / UI表示用の説明
 */
export async function enqueueMutation(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  description: string,
): Promise<void> {
  const database = await openDb();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const mutation: Omit<QueuedMutation, 'id'> = {
      url,
      method,
      headers,
      body,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      description,
    };

    const request = store.add(mutation);
    request.onsuccess = () => {
      notifyListeners();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending mutations in the queue.
 *
 * @returns Array of queued mutations. / キューに入っているミューテーション配列
 */
export async function getPendingMutations(): Promise<QueuedMutation[]> {
  const database = await openDb();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as QueuedMutation[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a mutation from the queue after successful replay.
 */
async function removeMutation(id: number): Promise<void> {
  const database = await openDb();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Increment retry count for a failed mutation.
 */
async function incrementRetry(mutation: QueuedMutation): Promise<void> {
  const database = await openDb();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ ...mutation, retryCount: mutation.retryCount + 1 });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Maximum retries before a mutation is discarded. */
const MAX_RETRIES = 5;

/**
 * Replay all pending mutations in order.
 *
 * Called automatically when the browser goes online.
 * Mutations that fail after MAX_RETRIES are discarded.
 *
 * @returns Number of successfully replayed mutations. / 正常にリプレイされたミューテーション数
 */
export async function syncQueue(): Promise<number> {
  if (syncing) return 0;
  syncing = true;
  notifyListeners();

  let successCount = 0;

  try {
    const mutations = await getPendingMutations();

    for (const mutation of mutations) {
      try {
        const response = await fetch(mutation.url, {
          method: mutation.method,
          headers: mutation.headers,
          body: mutation.body,
        });

        if (response.ok || (response.status >= 400 && response.status < 500)) {
          // NOTE: Remove on success or 4xx (client error — retrying won't help).
          await removeMutation(mutation.id);
          if (response.ok) successCount++;
        } else {
          // Server error — retry later
          if (mutation.retryCount >= MAX_RETRIES) {
            await removeMutation(mutation.id);
          } else {
            await incrementRetry(mutation);
          }
        }
      } catch {
        // Network still unavailable — stop syncing
        break;
      }
    }

    lastSyncAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Sync failed';
  } finally {
    syncing = false;
    notifyListeners();
  }

  return successCount;
}

/**
 * Get current queue status.
 */
export async function getQueueStatus(): Promise<QueueStatus> {
  try {
    const mutations = await getPendingMutations();
    return {
      pendingCount: mutations.length,
      isSyncing: syncing,
      lastSyncAt,
      lastError,
    };
  } catch {
    return { pendingCount: 0, isSyncing: syncing, lastSyncAt, lastError };
  }
}

/**
 * Clear all pending mutations.
 */
export async function clearQueue(): Promise<void> {
  const database = await openDb();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      notifyListeners();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/** Notify UI listeners of queue state changes. */
function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

/**
 * Subscribe to queue state changes.
 *
 * @param listener - Callback invoked on queue changes. / キュー変更時に呼ばれるコールバック
 * @returns Unsubscribe function. / 購読解除関数
 */
export function subscribeToQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Enhanced fetch that queues mutations when offline.
 *
 * Drop-in replacement for fetch() that automatically queues write operations
 * (POST/PUT/PATCH/DELETE) when the network is unavailable.
 *
 * @param url - Request URL. / リクエストURL
 * @param init - Fetch options. / fetchオプション
 * @param description - Human-readable description for the queue UI. / キューUI用の説明
 * @returns Fetch response, or a synthetic 202 Accepted if queued. / fetchレスポンスまたはキューされた場合は202
 */
export async function offlineFetch(
  url: string,
  init?: RequestInit,
  description?: string,
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();

  // GET requests are not queued — they use cache
  if (method === 'GET') {
    return fetch(url, init);
  }

  try {
    const response = await fetch(url, init);
    return response;
  } catch (error) {
    // Network error — queue the mutation
    if (!navigator.onLine || (error instanceof TypeError && error.message.includes('fetch'))) {
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((v, k) => { headers[k] = v; });
        } else if (Array.isArray(h)) {
          h.forEach(([k, v]) => { headers[k] = v; });
        } else {
          Object.assign(headers, h);
        }
      }

      await enqueueMutation(
        url,
        method,
        headers,
        typeof init?.body === 'string' ? init.body : null,
        description || `${method} ${new URL(url).pathname}`,
      );

      // Return synthetic 202 Accepted so the caller knows it was queued
      return new Response(JSON.stringify({ queued: true, message: 'Saved offline. Will sync when online.' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw error;
  }
}

// Auto-sync when browser comes online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncQueue().catch(() => {});
  });
}
