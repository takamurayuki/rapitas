/**
 * ExecutorSingleton
 *
 * Manages the single shared instance of the parallel executor.
 * Centralised here so all route modules share the same instance
 * without circular dependencies.
 */
import { prisma } from '../../../config/database';
import { createParallelExecutor } from '../../../services/parallel-execution';

let parallelExecutor: ReturnType<typeof createParallelExecutor> | null = null;

/**
 * Return the shared parallel executor, creating it on first call.
 *
 * @returns Singleton parallel executor instance / シングルトンパラレルエクゼキューター
 */
export function getParallelExecutor(): ReturnType<typeof createParallelExecutor> {
  if (!parallelExecutor) {
    parallelExecutor = createParallelExecutor(prisma);
  }
  return parallelExecutor;
}
