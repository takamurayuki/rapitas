/**
 * ParallelExecutor Factory Utility
 *
 * Provides centralized management of ParallelExecutor instances
 * to ensure proper resource management and avoid memory leaks.
 */

import { ParallelExecutor } from '../../services/parallel-execution/parallel-executor';
import { PrismaClient } from '@prisma/client';

// Singleton instance management
let parallelExecutorInstance: ParallelExecutor | null = null;

/**
 * Get or create ParallelExecutor instance
 *
 * @param prisma - Prisma client instance
 * @returns ParallelExecutor instance
 */
export function getParallelExecutor(prisma: PrismaClient): ParallelExecutor {
  if (!parallelExecutorInstance) {
    parallelExecutorInstance = new ParallelExecutor(prisma);
  }
  return parallelExecutorInstance;
}

/**
 * Cleanup ParallelExecutor instance
 * Should be called when shutting down the application
 */
export function cleanupParallelExecutor(): void {
  if (parallelExecutorInstance) {
    // If ParallelExecutor has cleanup methods, call them here
    parallelExecutorInstance = null;
  }
}

/**
 * Check if ParallelExecutor instance is active
 *
 * @returns boolean indicating if executor is initialized
 */
export function isParallelExecutorActive(): boolean {
  return parallelExecutorInstance !== null;
}
