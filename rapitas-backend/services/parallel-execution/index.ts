/**
 * Parallel Execution System
 *
 * Module for managing dependency analysis and parallel execution of subtasks.
 */

// Type definitions
export * from './types';

// Dependency analysis
export { DependencyAnalyzer, createDependencyAnalyzer } from './dependency-analyzer';

// Parallel scheduler
export { ParallelScheduler, createParallelScheduler } from './parallel-scheduler';

// Sub-agent controller
export { SubAgentController, createSubAgentController } from './sub-agent-controller';

// Log aggregation
export { LogAggregator, LogFormatter, createLogAggregator } from './log-aggregator';

// Agent coordination
export { AgentCoordinator, createAgentCoordinator } from './agent-coordinator';

// Conflict detection and merge validation
export { ConflictDetector } from './conflict-detector';
export { MergeValidator } from './merge-validator';
export * from './safety-types';

// Parallel execution orchestrator
export { ParallelExecutor, createParallelExecutor } from './parallel-executor';
