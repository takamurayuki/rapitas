/**
 * 並列実行システムのユニットテスト
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  DependencyAnalyzer,
  createDependencyAnalyzer,
  ParallelScheduler,
  createParallelScheduler,
  LogAggregator,
  createLogAggregator,
  AgentCoordinator,
  createAgentCoordinator,
  type DependencyAnalysisInput,
  type TaskNode,
  type ParallelExecutionPlan,
  type ParallelExecutionConfig,
} from '../../services/parallel-execution';

describe('DependencyAnalyzer', () => {
  let analyzer: DependencyAnalyzer;

  beforeEach(() => {
    analyzer = createDependencyAnalyzer();
  });

  it('should analyze dependencies between subtasks', () => {
    const input: DependencyAnalysisInput = {
      parentTaskId: 1,
      subtasks: [
        {
          id: 101,
          title: 'タスク1',
          description: 'src/components/button.tsx を修正',
          priority: 'high',
          estimatedHours: 2,
        },
        {
          id: 102,
          title: 'タスク2',
          description: 'src/components/button.tsx と src/styles/button.css を更新',
          priority: 'medium',
          estimatedHours: 1,
        },
        {
          id: 103,
          title: 'タスク3',
          description: 'src/utils/helper.ts を追加',
          priority: 'low',
          estimatedHours: 1,
        },
      ],
    };

    const result = analyzer.analyze(input);

    expect(result.treeMap).toBeDefined();
    expect(result.treeMap.nodes.size).toBe(3);
    expect(result.plan).toBeDefined();
    expect(result.recommendations).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it('should detect file sharing dependencies', () => {
    const input: DependencyAnalysisInput = {
      parentTaskId: 1,
      subtasks: [
        {
          id: 101,
          title: 'タスク1',
          files: ['src/index.ts'],
          priority: 'high',
        },
        {
          id: 102,
          title: 'タスク2',
          files: ['src/index.ts', 'src/utils.ts'],
          priority: 'medium',
        },
      ],
    };

    const result = analyzer.analyze(input);

    // There should be edges from shared files
    const edges = result.treeMap.edges.filter((e) => e.type === 'file_sharing');
    expect(edges.length).toBeGreaterThan(0);
  });

  it('should calculate parallel groups', () => {
    const input: DependencyAnalysisInput = {
      parentTaskId: 1,
      subtasks: [
        {
          id: 101,
          title: '独立タスク1',
          files: ['file1.ts'],
          priority: 'high',
        },
        {
          id: 102,
          title: '独立タスク2',
          files: ['file2.ts'],
          priority: 'high',
        },
        {
          id: 103,
          title: '独立タスク3',
          files: ['file3.ts'],
          priority: 'medium',
        },
      ],
    };

    const result = analyzer.analyze(input);

    // Independent tasks should be in the same group
    expect(result.treeMap.parallelGroups.length).toBeGreaterThan(0);
    const firstGroup = result.treeMap.parallelGroups[0];
    expect(firstGroup.canRunParallel).toBe(true);
  });

  it('should calculate parallel efficiency', () => {
    const input: DependencyAnalysisInput = {
      parentTaskId: 1,
      subtasks: [
        {
          id: 101,
          title: 'タスク1',
          priority: 'high',
          estimatedHours: 2,
        },
        {
          id: 102,
          title: 'タスク2',
          priority: 'medium',
          estimatedHours: 3,
        },
        {
          id: 103,
          title: 'タスク3',
          priority: 'low',
          estimatedHours: 1,
        },
      ],
    };

    const result = analyzer.analyze(input);

    // Parallelization efficiency should be calculated
    expect(result.plan.parallelEfficiency).toBeGreaterThanOrEqual(0);
    expect(result.plan.estimatedSequentialDuration).toBe(6); // 2+3+1
  });
});

describe('ParallelScheduler', () => {
  let scheduler: ParallelScheduler;
  let plan: ParallelExecutionPlan;
  let nodes: Map<number, TaskNode>;
  let config: ParallelExecutionConfig;

  beforeEach(() => {
    nodes = new Map();
    nodes.set(101, {
      id: 101,
      title: 'タスク1',
      priority: 'high',
      estimatedHours: 1,
      status: 'pending',
      dependencies: [],
      dependents: [102],
      depth: 0,
      independenceScore: 90,
      parallelizability: 80,
      files: [],
      tags: [],
    });
    nodes.set(102, {
      id: 102,
      title: 'タスク2',
      priority: 'medium',
      estimatedHours: 2,
      status: 'pending',
      dependencies: [101],
      dependents: [],
      depth: 1,
      independenceScore: 70,
      parallelizability: 60,
      files: [],
      tags: [],
    });
    nodes.set(103, {
      id: 103,
      title: 'タスク3',
      priority: 'low',
      estimatedHours: 1,
      status: 'pending',
      dependencies: [],
      dependents: [],
      depth: 0,
      independenceScore: 100,
      parallelizability: 100,
      files: [],
      tags: [],
    });

    plan = {
      id: 'test-plan',
      parentTaskId: 1,
      createdAt: new Date(),
      groups: [
        {
          groupId: 0,
          level: 0,
          taskIds: [101, 103],
          canRunParallel: true,
          estimatedDuration: 1,
          internalDependencies: [],
          dependsOnGroups: [],
        },
        {
          groupId: 1,
          level: 1,
          taskIds: [102],
          canRunParallel: true,
          estimatedDuration: 2,
          internalDependencies: [],
          dependsOnGroups: [0],
        },
      ],
      executionOrder: [[101, 103], [102]],
      estimatedTotalDuration: 3,
      estimatedSequentialDuration: 4,
      parallelEfficiency: 25,
      maxConcurrency: 3,
      resourceConstraints: [],
    };

    config = {
      maxConcurrentAgents: 3,
      questionTimeoutSeconds: 300,
      taskTimeoutSeconds: 900,
      retryOnFailure: true,
      maxRetries: 2,
      logSharing: true,
      coordinationEnabled: true,
    };

    scheduler = createParallelScheduler(plan, nodes, config);
  });

  it('should return executable tasks respecting dependencies', () => {
    const executable = scheduler.getNextExecutableTasks();

    // Level 0 tasks (101, 103) should be executable
    expect(executable).toContain(101);
    expect(executable).toContain(103);
    // Level 1 task (102) has dependencies, so it should not be executable
    expect(executable).not.toContain(102);
  });

  it('should update status when task starts', () => {
    scheduler.startTask(101);

    expect(scheduler.getTaskStatus(101)).toBe('running');
  });

  it('should resolve dependencies when task completes', () => {
    scheduler.startTask(101);
    scheduler.completeTask(101);

    // When task 101 completes, task 102 becomes executable
    const executable = scheduler.getNextExecutableTasks();
    expect(executable).toContain(102);
  });

  it('should track progress correctly', () => {
    scheduler.startTask(101);
    scheduler.startTask(103);
    scheduler.completeTask(101);

    const status = scheduler.getStatus();
    expect(status.completed).toContain(101);
    expect(status.running).toContain(103);
    expect(status.progress).toBeGreaterThan(0);
  });

  it('should block dependent tasks when task fails', () => {
    scheduler.startTask(101);
    scheduler.failTask(101);

    // When task 101 fails, task 102 should be blocked
    expect(scheduler.getTaskStatus(102)).toBe('blocked');
  });
});

describe('LogAggregator', () => {
  let aggregator: LogAggregator;

  beforeEach(() => {
    aggregator = createLogAggregator(100);
  });

  it('should add and retrieve logs', () => {
    aggregator.addLog({
      timestamp: new Date(),
      agentId: 'agent-1',
      taskId: 101,
      level: 'info',
      message: 'タスクを開始しました',
    });

    const logs = aggregator.getLogsByTask(101);
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe('タスクを開始しました');
  });

  it('should filter logs by level', () => {
    aggregator.addLog({
      timestamp: new Date(),
      agentId: 'agent-1',
      taskId: 101,
      level: 'info',
      message: '情報メッセージ',
    });
    aggregator.addLog({
      timestamp: new Date(),
      agentId: 'agent-1',
      taskId: 101,
      level: 'error',
      message: 'エラーメッセージ',
    });

    const errors = aggregator.getErrorLogs();
    expect(errors.length).toBe(1);
    expect(errors[0].level).toBe('error');
  });

  it('should extract tags from messages', () => {
    const id = aggregator.addLog({
      timestamp: new Date(),
      agentId: 'agent-1',
      taskId: 101,
      level: 'info',
      message: 'git commit completed successfully',
    });

    const logs = aggregator.getLogsByTag('git');
    expect(logs.length).toBe(1);
    expect(logs[0].tags).toContain('git');
  });

  it('should provide summary statistics', () => {
    aggregator.addLog({
      timestamp: new Date(),
      agentId: 'agent-1',
      taskId: 101,
      level: 'info',
      message: 'メッセージ1',
    });
    aggregator.addLog({
      timestamp: new Date(),
      agentId: 'agent-2',
      taskId: 102,
      level: 'error',
      message: 'メッセージ2',
    });

    const summary = aggregator.getSummary();
    expect(summary.totalLogs).toBe(2);
    expect(summary.byAgent['agent-1']).toBe(1);
    expect(summary.byAgent['agent-2']).toBe(1);
    expect(summary.byLevel['info']).toBe(1);
    expect(summary.byLevel['error']).toBe(1);
  });

  it('should handle ring buffer overflow', () => {
    const smallAggregator = createLogAggregator(5);

    // Add 10 log entries
    for (let i = 0; i < 10; i++) {
      smallAggregator.addLog({
        timestamp: new Date(),
        agentId: 'agent-1',
        taskId: 101,
        level: 'info',
        message: `メッセージ${i}`,
      });
    }

    // Only a maximum of 5 logs should be retained
    const summary = smallAggregator.getSummary();
    expect(summary.totalLogs).toBe(5);
  });
});

describe('AgentCoordinator', () => {
  let coordinator: AgentCoordinator;

  beforeEach(() => {
    coordinator = createAgentCoordinator();
  });

  it('should manage resource locks', () => {
    const lock1 = coordinator.requestResourceLock('agent-1', 101, 'file.ts');
    expect(lock1.status).toBe('granted');

    // Another agent trying to lock the same resource should be denied
    const lock2 = coordinator.requestResourceLock('agent-2', 102, 'file.ts');
    expect(lock2.status).toBe('denied');

    // Release the lock
    coordinator.releaseResourceLock('agent-1', 'file.ts');

    // Now the lock can be acquired
    const lock3 = coordinator.requestResourceLock('agent-2', 102, 'file.ts');
    expect(lock3.status).toBe('granted');
  });

  it('should track dependency resolution', () => {
    coordinator.registerDependency(102, [101]);
    expect(coordinator.isDependencyResolved(102)).toBe(false);

    coordinator.resolveDependency(101);
    expect(coordinator.isDependencyResolved(102)).toBe(true);
  });

  it('should share data between agents', () => {
    coordinator.shareData('result-101', { value: 42 }, 'agent-1');

    const data = coordinator.getSharedData('result-101') as { value: number };
    expect(data.value).toBe(42);
  });

  it('should track message history', () => {
    coordinator.broadcastMessage({
      id: 'msg-1',
      timestamp: new Date(),
      fromAgentId: 'agent-1',
      toAgentId: 'broadcast',
      type: 'task_started',
      payload: { taskId: 101 },
    });

    const history = coordinator.getMessageHistory({ type: 'task_started' });
    expect(history.length).toBe(1);
  });

  it('should provide statistics', () => {
    coordinator.requestResourceLock('agent-1', 101, 'file.ts');
    coordinator.registerDependency(102, [101]);
    coordinator.resolveDependency(101);

    const stats = coordinator.getStatistics();
    expect(stats.lockedResources).toBe(1);
    expect(stats.resolvedDependencies).toBe(1);
  });
});

describe('Integration: Dependency Analysis to Scheduling', () => {
  it('should create a valid execution plan from analysis', () => {
    const analyzer = createDependencyAnalyzer();
    const input: DependencyAnalysisInput = {
      parentTaskId: 1,
      subtasks: [
        { id: 101, title: 'API設計', priority: 'high', estimatedHours: 2 },
        {
          id: 102,
          title: 'DBスキーマ作成',
          priority: 'high',
          estimatedHours: 1,
          explicitDependencies: [101],
        },
        { id: 103, title: 'フロントエンド', priority: 'medium', estimatedHours: 3 },
        {
          id: 104,
          title: 'バックエンド',
          priority: 'medium',
          estimatedHours: 3,
          explicitDependencies: [101, 102],
        },
        {
          id: 105,
          title: 'テスト',
          priority: 'low',
          estimatedHours: 2,
          explicitDependencies: [103, 104],
        },
      ],
    };

    const result = analyzer.analyze(input);

    // Verify the plan was generated correctly
    expect(result.plan.groups.length).toBeGreaterThan(0);
    expect(result.plan.executionOrder.length).toBeGreaterThan(0);

    // Create a scheduler and verify execution order
    const config: ParallelExecutionConfig = {
      maxConcurrentAgents: 2,
      questionTimeoutSeconds: 300,
      taskTimeoutSeconds: 900,
      retryOnFailure: true,
      maxRetries: 2,
      logSharing: true,
      coordinationEnabled: true,
    };

    const scheduler = createParallelScheduler(result.plan, result.treeMap.nodes, config);

    // First batch of executable tasks
    const firstBatch = scheduler.getNextExecutableTasks();

    // 101 and 103 have no dependencies so are executable (maxConcurrency=2, so up to 2)
    expect(firstBatch.length).toBeLessThanOrEqual(2);
    expect(firstBatch.some((id) => id === 101 || id === 103)).toBe(true);

    // 105 has dependencies so it should not be executable initially
    expect(firstBatch).not.toContain(105);
  });
});
