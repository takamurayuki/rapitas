/**
 * Agent Coordinator
 *
 * Shares task progress and results between sub-agents for coordination.
 */

import { EventEmitter } from 'events';
import type {
  AgentMessage,
  AgentMessageType,
  SubAgentState,
  ParallelExecutionStatus,
} from './types-dir/types';

/**
 * Resource lock information
 */
type ResourceLock = {
  resource: string;
  agentId: string;
  taskId: number;
  lockedAt: Date;
  expiresAt?: Date;
};

/**
 * Coordination request
 */
type CoordinationRequest = {
  id: string;
  fromAgentId: string;
  type: 'resource_lock' | 'dependency_wait' | 'data_share' | 'sync_point';
  resource?: string;
  data?: unknown;
  status: 'pending' | 'granted' | 'denied' | 'timeout';
  createdAt: Date;
  resolvedAt?: Date;
};

/**
 * Dependency resolution state
 */
type DependencyState = {
  taskId: number;
  dependsOn: number[];
  resolvedDependencies: number[];
  isResolved: boolean;
};

/**
 * Agent coordinator
 */
export class AgentCoordinator extends EventEmitter {
  private resourceLocks: Map<string, ResourceLock> = new Map();
  private coordinationRequests: Map<string, CoordinationRequest> = new Map();
  private dependencyStates: Map<number, DependencyState> = new Map();
  private sharedData: Map<string, unknown> = new Map();
  private agentStates: Map<string, SubAgentState> = new Map();

  // Message history (for debugging)
  private messageHistory: AgentMessage[] = [];
  private maxHistorySize: number = 1000;

  constructor() {
    super();
  }

  /**
   * Request a resource lock.
   */
  requestResourceLock(
    agentId: string,
    taskId: number,
    resource: string,
    timeout?: number,
  ): CoordinationRequest {
    const requestId = `lock-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Check for existing lock
    const existingLock = this.resourceLocks.get(resource);
    if (existingLock) {
      // Allow if same agent
      if (existingLock.agentId === agentId) {
        return {
          id: requestId,
          fromAgentId: agentId,
          type: 'resource_lock',
          resource,
          status: 'granted',
          createdAt: new Date(),
          resolvedAt: new Date(),
        };
      }

      // Check if expired
      if (existingLock.expiresAt && existingLock.expiresAt < new Date()) {
        this.resourceLocks.delete(resource);
      } else {
        // Already locked
        const request: CoordinationRequest = {
          id: requestId,
          fromAgentId: agentId,
          type: 'resource_lock',
          resource,
          status: 'denied',
          createdAt: new Date(),
          resolvedAt: new Date(),
        };
        this.coordinationRequests.set(requestId, request);

        this.emit('lock_denied', {
          requestId,
          agentId,
          resource,
          lockedBy: existingLock.agentId,
        });

        return request;
      }
    }

    // Acquire the lock
    const lock: ResourceLock = {
      resource,
      agentId,
      taskId,
      lockedAt: new Date(),
      expiresAt: timeout ? new Date(Date.now() + timeout) : undefined,
    };
    this.resourceLocks.set(resource, lock);

    const request: CoordinationRequest = {
      id: requestId,
      fromAgentId: agentId,
      type: 'resource_lock',
      resource,
      status: 'granted',
      createdAt: new Date(),
      resolvedAt: new Date(),
    };
    this.coordinationRequests.set(requestId, request);

    this.emit('lock_granted', {
      requestId,
      agentId,
      resource,
    });

    // Broadcast message
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'resource_locked',
      payload: { resource, taskId },
    });

    return request;
  }

  /**
   * Release a resource lock.
   */
  releaseResourceLock(agentId: string, resource: string): boolean {
    const lock = this.resourceLocks.get(resource);
    if (!lock) return false;

    // Only the owning agent can release the lock
    if (lock.agentId !== agentId) {
      return false;
    }

    this.resourceLocks.delete(resource);

    this.emit('lock_released', {
      agentId,
      resource,
    });

    // Broadcast message
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'resource_released',
      payload: { resource },
    });

    return true;
  }

  /**
   * Register dependencies.
   */
  registerDependency(taskId: number, dependsOn: number[]): void {
    this.dependencyStates.set(taskId, {
      taskId,
      dependsOn,
      resolvedDependencies: [],
      isResolved: dependsOn.length === 0,
    });

    if (dependsOn.length === 0) {
      this.emit('dependency_resolved', { taskId });
    }
  }

  /**
   * Resolve dependencies.
   */
  resolveDependency(completedTaskId: number): number[] {
    const resolvedTasks: number[] = [];

    for (const [taskId, state] of this.dependencyStates) {
      if (
        state.dependsOn.includes(completedTaskId) &&
        !state.resolvedDependencies.includes(completedTaskId)
      ) {
        state.resolvedDependencies.push(completedTaskId);

        // Check if all dependencies are resolved
        if (state.resolvedDependencies.length === state.dependsOn.length) {
          state.isResolved = true;
          resolvedTasks.push(taskId);

          this.emit('dependency_resolved', { taskId });

          // Broadcast message
          this.broadcastMessage({
            id: `msg-${Date.now()}`,
            timestamp: new Date(),
            fromAgentId: 'coordinator',
            toAgentId: 'broadcast',
            type: 'dependency_resolved',
            payload: { taskId, resolvedBy: completedTaskId },
          });
        }
      }
    }

    return resolvedTasks;
  }

  /**
   * Check if dependencies are resolved.
   */
  isDependencyResolved(taskId: number): boolean {
    const state = this.dependencyStates.get(taskId);
    return state?.isResolved ?? true;
  }

  /**
   * Share data between agents.
   */
  shareData(key: string, data: unknown, fromAgentId: string): void {
    this.sharedData.set(key, data);

    this.emit('data_shared', {
      key,
      fromAgentId,
    });

    // Broadcast message
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId: 'broadcast',
      type: 'coordination_response',
      payload: { type: 'data_share', key, data },
    });
  }

  /**
   * Get shared data.
   */
  getSharedData(key: string): unknown | undefined {
    return this.sharedData.get(key);
  }

  /**
   * Update agent state.
   */
  updateAgentState(agentId: string, state: SubAgentState): void {
    this.agentStates.set(agentId, state);

    this.emit('agent_state_updated', {
      agentId,
      status: state.status,
    });
  }

  /**
   * Get agent state.
   */
  getAgentState(agentId: string): SubAgentState | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * Get agent state.
   */
  getAllAgentStates(): Map<string, SubAgentState> {
    return new Map(this.agentStates);
  }

  /**
   * Broadcast message
   */
  broadcastMessage(message: AgentMessage): void {
    // Add to message history
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    this.emit('message', message);
  }

  /**
   * Send a message to a specific agent.
   */
  sendMessage(
    toAgentId: string,
    fromAgentId: string,
    type: AgentMessageType,
    payload: unknown,
  ): void {
    const message: AgentMessage = {
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId,
      type,
      payload,
    };

    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    this.emit('message', message);
    this.emit(`message:${toAgentId}`, message);
  }

  /**
   * Create a sync point.
   */
  async waitForSyncPoint(
    syncPointId: string,
    agentIds: string[],
    timeout: number = 30000,
  ): Promise<boolean> {
    const syncState = new Map<string, boolean>();

    for (const agentId of agentIds) {
      syncState.set(agentId, false);
    }

    return new Promise((resolve) => {
      const checkSync = () => {
        const allSynced = Array.from(syncState.values()).every((v) => v);
        if (allSynced) {
          this.emit('sync_completed', { syncPointId, agentIds });
          resolve(true);
          return true;
        }
        return false;
      };

      const handler = (message: AgentMessage) => {
        if (
          message.type === 'coordination_response' &&
          (message.payload as { syncPointId?: string })?.syncPointId === syncPointId
        ) {
          syncState.set(message.fromAgentId, true);
          checkSync();
        }
      };

      this.on('message', handler);

      // Timeout
      setTimeout(() => {
        this.off('message', handler);
        if (!checkSync()) {
          this.emit('sync_timeout', { syncPointId, agentIds });
          resolve(false);
        }
      }, timeout);
    });
  }

  /**
   * Reach a sync point.
   */
  reachSyncPoint(syncPointId: string, agentId: string): void {
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'coordination_response',
      payload: { syncPointId },
    });
  }

  /**
   * Get message history.
   */
  getMessageHistory(filter?: {
    fromAgentId?: string;
    toAgentId?: string;
    type?: AgentMessageType;
    limit?: number;
  }): AgentMessage[] {
    let messages = [...this.messageHistory];

    if (filter?.fromAgentId) {
      messages = messages.filter((m) => m.fromAgentId === filter.fromAgentId);
    }
    if (filter?.toAgentId) {
      messages = messages.filter(
        (m) => m.toAgentId === filter.toAgentId || m.toAgentId === 'broadcast',
      );
    }
    if (filter?.type) {
      messages = messages.filter((m) => m.type === filter.type);
    }

    // Sort by most recent
    messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filter?.limit) {
      messages = messages.slice(0, filter.limit);
    }

    return messages;
  }

  /**
   * Get execution statistics.
   */
  getStatistics(): {
    activeAgents: number;
    lockedResources: number;
    pendingRequests: number;
    resolvedDependencies: number;
    messageCount: number;
  } {
    return {
      activeAgents: Array.from(this.agentStates.values()).filter((s) => s.status === 'running')
        .length,
      lockedResources: this.resourceLocks.size,
      pendingRequests: Array.from(this.coordinationRequests.values()).filter(
        (r) => r.status === 'pending',
      ).length,
      resolvedDependencies: Array.from(this.dependencyStates.values()).filter((s) => s.isResolved)
        .length,
      messageCount: this.messageHistory.length,
    };
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.resourceLocks.clear();
    this.coordinationRequests.clear();
    this.dependencyStates.clear();
    this.sharedData.clear();
    this.agentStates.clear();
    this.messageHistory = [];
  }
}

/**
 * Factory function for creating an agent coordinator.
 */
export function createAgentCoordinator(): AgentCoordinator {
  return new AgentCoordinator();
}
