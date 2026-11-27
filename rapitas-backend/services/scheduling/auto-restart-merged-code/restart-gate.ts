/**
 * RestartGate
 *
 * In-process mutex that makes the sections touching the restart wait mutually
 * exclusive: (a) dequeue + registering the execution, (b) handing an item to
 * its next phase, (c) beginning the wait, (d) stop / pause of a theme, (e) the
 * post-restart restore. Without it a wait could begin between a flag check and
 * the item turning `running`, and a stopped theme could be woken by a restore
 * that read its state a moment earlier.
 * One backend process owns the queue, so a process-local chain is enough; it is
 * not a cross-process lock. Not responsible for deciding when to wait.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

let tail: Promise<unknown> = Promise.resolve();
const inside = new AsyncLocalStorage<{ active: boolean }>();

/**
 * Run `fn` after every previously queued gate section has settled.
 *
 * NOTE: sections must not nest. A section that calls `withRestartGate` again
 * would wait for itself forever, so the nested call is rejected with an error
 * instead (the code that runs inside a section must never take the gate).
 * The gate is released whether `fn` resolves or rejects. Keep sections short:
 * they cover registering an execution, never running one.
 *
 * @param fn - Critical section / 排他区間の処理
 * @returns Whatever `fn` returns / fn の戻り値
 * @throws {Error} When called from inside another gate section / 入れ子で呼ばれた場合
 */
export function withRestartGate<T>(fn: () => Promise<T>): Promise<T> {
  if (inside.getStore()?.active) {
    return Promise.reject(new Error('restart-gate: nested acquisition would deadlock'));
  }
  const section = () => {
    const scope = { active: true };
    return inside.run(scope, async () => {
      try {
        return await fn();
      } finally {
        // 登録後に残る非同期処理はロック外。終了済み区間の継承は入れ子ではない。
        scope.active = false;
      }
    });
  };
  const run = tail.then(section, section);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
