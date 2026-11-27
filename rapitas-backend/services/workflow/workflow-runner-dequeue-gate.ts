/**
 * workflow-runner-dequeue-gate
 *
 * Dequeues one item and registers its execution inside the restart gate, so a
 * restart wait can never begin between "the item became running" and "the
 * runner counts it as active". Not responsible for running the item.
 */
import { guardedStart } from '../scheduling/auto-restart-merged-code/guarded-start';
import type { QueueItem } from './workflow-queue.types';

/**
 * Take the next item and hand it to `start` (which must register it as active
 * synchronously) while holding the restart gate.
 *
 * @param queue - Queue to dequeue from / 取り出し元のキュー
 * @param start - Registers the execution; called only with a dequeued item / 実行登録
 * @returns The started item, or null when nothing was started / 開始した項目（無ければnull）
 */
export function dequeueAndStart(
  queue: { dequeue(): Promise<QueueItem | null> },
  start: (item: QueueItem) => void,
): Promise<QueueItem | null> {
  return guardedStart(
    async () => {
      const item = await queue.dequeue();
      if (item) start(item);
      return item;
    },
    async () => null,
  );
}
