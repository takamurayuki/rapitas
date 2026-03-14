/**
 * Dependencies
 * Dependencies
 */

import type {
  TaskNode,
  TaskPriority,
  DependencyEdge,
  DependencyType,
  DependencyTreeMap,
  DependencyAnalysisInput,
  DependencyAnalysisResult,
  ParallelGroup,
  ParallelExecutionPlan,
  ResourceConstraint,
} from './types';

/**
 */
function extractFilePaths(text: string | null | undefined): string[] {
  if (!text) return [];

  const patterns = [
    // Unix/Mac
    /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // Windows
    /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // src/components/...
    /(?:^|\s|["'`])((?:src|lib|app|components|pages|features?|services?|utils?|hooks?|types?|api|routes?)[\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1].replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

      if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
}

/**
 */
function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 */
function priorityToWeight(priority: TaskPriority): number {
  switch (priority) {
    case 'urgent':
      return 100;
    case 'high':
      return 75;
    case 'medium':
      return 50;
    case 'low':
      return 25;
  }
}

/**
 * Dependencies
 */
export class DependencyAnalyzer {
  private nodes: Map<number, TaskNode> = new Map();
  private edges: DependencyEdge[] = [];

  constructor() {}

  /**
   * Dependencies
   */
  analyze(input: DependencyAnalysisInput): DependencyAnalysisResult {
    this.nodes.clear();
    this.edges = [];

    this.initializeNodes(input);

    // Dependencies
    this.calculateDependencyEdges();

    // Independence score
    this.calculateNodeMetrics();

    // Parallel execution group
    const parallelGroups = this.generateParallelGroups();

    const criticalPath = this.calculateCriticalPath();

    const treeMap: DependencyTreeMap = {
      nodes: this.nodes,
      edges: this.edges,
      criticalPath,
      parallelGroups,
      maxDepth: this.calculateMaxDepth(),
      totalWeight: this.calculateTotalWeight(),
    };

    const plan = this.generateExecutionPlan(input.parentTaskId, treeMap, input.config);

    const { recommendations, warnings } = this.generateRecommendations(treeMap);

    return {
      treeMap,
      plan,
      recommendations,
      warnings,
    };
  }

  /**
   */
  private initializeNodes(input: DependencyAnalysisInput): void {
    for (const subtask of input.subtasks) {
      const extractedFiles = extractFilePaths(subtask.description);
      const files = [...new Set([...(subtask.files || []), ...extractedFiles])];

      const node: TaskNode = {
        id: subtask.id,
        title: subtask.title,
        description: subtask.description,
        priority: subtask.priority,
        estimatedHours: subtask.estimatedHours || 1,
        status: 'pending',
        dependencies: subtask.explicitDependencies || [],
        dependents: [],
        depth: 0,
        independenceScore: 100,
        parallelizability: 100,
        files,
        tags: [],
      };

      this.nodes.set(subtask.id, node);
    }

    // Dependencies dependents
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode && !depNode.dependents.includes(node.id)) {
          depNode.dependents.push(node.id);
        }
      }
    }
  }

  /**
   * Dependencies
   */
  private calculateDependencyEdges(): void {
    const nodeArray = Array.from(this.nodes.values());

    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const node1 = nodeArray[i];
        const node2 = nodeArray[j];

        // Dependencies
        const sharedFiles = this.findSharedFiles(node1, node2);
        if (sharedFiles.length > 0) {
          const weight = this.calculateFileSharingWeight(node1, node2, sharedFiles);

          this.edges.push({
            fromTaskId: node1.id,
            toTaskId: node2.id,
            type: 'file_sharing',
            weight,
            sharedResources: sharedFiles,
            description: `共有ファイル: ${sharedFiles.join(', ')}`,
          });

          if (!node1.dependencies.includes(node2.id)) {
            if (priorityToWeight(node1.priority) < priorityToWeight(node2.priority)) {
              node1.dependencies.push(node2.id);
              node2.dependents.push(node1.id);
            }
          }
        }

        if (node1.dependencies.includes(node2.id)) {
          this.edges.push({
            fromTaskId: node2.id,
            toTaskId: node1.id,
            type: 'sequential',
            weight: 100,
            sharedResources: [],
            description: '明示的な順序依存',
          });
        }
        if (node2.dependencies.includes(node1.id)) {
          this.edges.push({
            fromTaskId: node1.id,
            toTaskId: node2.id,
            type: 'sequential',
            weight: 100,
            sharedResources: [],
            description: '明示的な順序依存',
          });
        }
      }
    }
  }

  /**
   */
  private findSharedFiles(node1: TaskNode, node2: TaskNode): string[] {
    const fileNames1 = new Set(node1.files.map(getFileName));
    const fileNames2 = new Set(node2.files.map(getFileName));

    const shared: string[] = [];
    for (const fileName of fileNames1) {
      if (fileNames2.has(fileName)) {
        shared.push(fileName);
      }
    }
    return shared;
  }

  /**
   */
  private calculateFileSharingWeight(
    node1: TaskNode,
    node2: TaskNode,
    sharedFiles: string[],
  ): number {
    const node1FileCount = node1.files.length || 1;
    const node2FileCount = node2.files.length || 1;

    const ratio1 = sharedFiles.length / node1FileCount;
    const ratio2 = sharedFiles.length / node2FileCount;
    const avgRatio = (ratio1 + ratio2) / 2;

    let typeWeight = 1.0;
    for (const file of sharedFiles) {
      if (file.match(/\.(ts|tsx|js|jsx)$/)) typeWeight = Math.max(typeWeight, 1.2);
      if (file.match(/\.(css|scss|sass)$/)) typeWeight = Math.max(typeWeight, 1.1);
      if (file.match(/\.(json|yaml|yml)$/)) typeWeight = Math.max(typeWeight, 1.3);
      if (file.match(/index\./)) typeWeight = Math.max(typeWeight, 1.5);
      if (file.match(/schema\./)) typeWeight = Math.max(typeWeight, 1.5);
    }

    return Math.round(avgRatio * 100 * typeWeight);
  }

  /**
   * Metrics
   */
  private calculateNodeMetrics(): void {
    const visited = new Set<number>();
    const depths = new Map<number, number>();

    const calculateDepth = (nodeId: number): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // Avoid circular dependencies

      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (!node) return 0;

      let maxDepth = 0;
      for (const depId of node.dependencies) {
        maxDepth = Math.max(maxDepth, calculateDepth(depId) + 1);
      }

      depths.set(nodeId, maxDepth);
      visited.delete(nodeId);
      return maxDepth;
    };

    for (const nodeId of this.nodes.keys()) {
      const depth = calculateDepth(nodeId);
      const node = this.nodes.get(nodeId)!;
      node.depth = depth;

      // Independence score
      const totalEdgeWeight = this.edges
        .filter((e) => e.fromTaskId === nodeId || e.toTaskId === nodeId)
        .reduce((sum, e) => sum + e.weight, 0);

      const maxPossibleWeight = this.nodes.size * 100;
      node.independenceScore = Math.max(
        0,
        100 - Math.round((totalEdgeWeight / maxPossibleWeight) * 100),
      );

      // Parallelizability score
      const dependencyCount = node.dependencies.length;
      const dependentCount = node.dependents.length;
      const connectionRatio = (dependencyCount + dependentCount) / (this.nodes.size - 1);
      node.parallelizability = Math.max(0, Math.round(100 - connectionRatio * 50));
    }
  }

  /**
   * Parallel execution group
   */
  private generateParallelGroups(): ParallelGroup[] {
    const groups: ParallelGroup[] = [];
    const assigned = new Set<number>();

    const maxDepth = this.calculateMaxDepth();

    for (let level = 0; level <= maxDepth; level++) {
      const levelTasks: number[] = [];

      for (const node of this.nodes.values()) {
        if (node.depth === level && !assigned.has(node.id)) {
          const canSchedule = node.dependencies.every((depId) => {
            const depNode = this.nodes.get(depId);
            return depNode && depNode.depth < level;
          });

          if (canSchedule) {
            levelTasks.push(node.id);
            assigned.add(node.id);
          }
        }
      }

      if (levelTasks.length > 0) {
        // Dependencies
        const internalDeps = this.edges.filter(
          (e) => levelTasks.includes(e.fromTaskId) && levelTasks.includes(e.toTaskId),
        );

        const dependsOnGroups: number[] = [];
        for (const taskId of levelTasks) {
          const node = this.nodes.get(taskId)!;
          for (const depId of node.dependencies) {
            const depGroup = groups.find((g) => g.taskIds.includes(depId));
            if (depGroup && !dependsOnGroups.includes(depGroup.groupId)) {
              dependsOnGroups.push(depGroup.groupId);
            }
          }
        }

        const estimatedDuration = Math.max(
          ...levelTasks.map((id) => this.nodes.get(id)?.estimatedHours || 1),
        );

        groups.push({
          groupId: groups.length,
          level,
          taskIds: levelTasks,
          canRunParallel: internalDeps.every((e) => e.weight < 70),
          estimatedDuration,
          internalDependencies: internalDeps,
          dependsOnGroups,
        });
      }
    }

    return groups;
  }

  /**
   */
  private calculateCriticalPath(): number[] {
    const distances = new Map<number, number>();
    const predecessors = new Map<number, number | null>();

    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, -Infinity);
      predecessors.set(nodeId, null);
    }

    const startNodes = Array.from(this.nodes.values())
      .filter((n) => n.dependencies.length === 0)
      .map((n) => n.id);

    for (const startId of startNodes) {
      distances.set(startId, this.nodes.get(startId)?.estimatedHours || 0);
    }

    const sorted = this.topologicalSort();

    for (const nodeId of sorted) {
      const node = this.nodes.get(nodeId)!;
      const currentDist = distances.get(nodeId)!;

      for (const dependentId of node.dependents) {
        const dependent = this.nodes.get(dependentId)!;
        const newDist = currentDist + (dependent.estimatedHours || 0);

        if (newDist > (distances.get(dependentId) || -Infinity)) {
          distances.set(dependentId, newDist);
          predecessors.set(dependentId, nodeId);
        }
      }
    }

    let maxDist = -Infinity;
    let endNode: number | null = null;
    for (const [nodeId, dist] of distances) {
      if (dist > maxDist) {
        maxDist = dist;
        endNode = nodeId;
      }
    }

    const path: number[] = [];
    let current = endNode;
    while (current !== null) {
      path.unshift(current);
      current = predecessors.get(current) || null;
    }

    return path;
  }

  /**
   */
  private topologicalSort(): number[] {
    const visited = new Set<number>();
    const result: number[] = [];

    const visit = (nodeId: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          visit(depId);
        }
      }
      result.push(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return result;
  }

  /**
   */
  private calculateMaxDepth(): number {
    let maxDepth = 0;
    for (const node of this.nodes.values()) {
      maxDepth = Math.max(maxDepth, node.depth);
    }
    return maxDepth;
  }

  /**
   */
  private calculateTotalWeight(): number {
    return this.edges.reduce((sum, e) => sum + e.weight, 0);
  }

  /**
   */
  private generateExecutionPlan(
    parentTaskId: number,
    treeMap: DependencyTreeMap,
    config?: Partial<{ maxConcurrentAgents: number }>,
  ): ParallelExecutionPlan {
    const maxConcurrency = config?.maxConcurrentAgents || 3;

    const executionOrder: number[][] = [];
    for (const group of treeMap.parallelGroups) {
      // maxConcurrency
      const tasks = [...group.taskIds];
      while (tasks.length > 0) {
        const batch = tasks.splice(0, maxConcurrency);
        executionOrder.push(batch);
      }
    }

    // Constraints
    const resourceConstraints = this.detectResourceConstraints();

    let estimatedTotalDuration = 0;
    for (const group of treeMap.parallelGroups) {
      estimatedTotalDuration += group.estimatedDuration;
    }

    const estimatedSequentialDuration = Array.from(treeMap.nodes.values()).reduce(
      (sum, n) => sum + (n.estimatedHours || 0),
      0,
    );

    const parallelEfficiency =
      estimatedSequentialDuration > 0
        ? Math.round((1 - estimatedTotalDuration / estimatedSequentialDuration) * 100)
        : 0;

    return {
      id: `plan-${parentTaskId}-${Date.now()}`,
      parentTaskId,
      createdAt: new Date(),
      groups: treeMap.parallelGroups,
      executionOrder,
      estimatedTotalDuration,
      estimatedSequentialDuration,
      parallelEfficiency: Math.max(0, parallelEfficiency),
      maxConcurrency,
      resourceConstraints,
    };
  }

  /**
   * Constraints
   */
  private detectResourceConstraints(): ResourceConstraint[] {
    const constraints: ResourceConstraint[] = [];
    const fileUsage = new Map<string, number[]>();

    for (const node of this.nodes.values()) {
      for (const file of node.files) {
        const fileName = getFileName(file);
        if (!fileUsage.has(fileName)) {
          fileUsage.set(fileName, []);
        }
        fileUsage.get(fileName)!.push(node.id);
      }
    }

    // Constraints
    for (const [fileName, taskIds] of fileUsage) {
      if (taskIds.length > 1) {
        const isImportantFile = fileName.match(/index\.|schema\.|config\.|package\.json/);
        constraints.push({
          type: 'file',
          resource: fileName,
          maxConcurrent: isImportantFile ? 1 : 2,
          affectedTasks: taskIds,
        });
      }
    }

    return constraints;
  }

  /**
   */
  private generateRecommendations(treeMap: DependencyTreeMap): {
    recommendations: string[];
    warnings: string[];
  } {
    const recommendations: string[] = [];
    const warnings: string[] = [];

    const highlyIndependent = Array.from(treeMap.nodes.values()).filter(
      (n) => n.independenceScore >= 80,
    );
    if (highlyIndependent.length > 0) {
      recommendations.push(
        `${highlyIndependent.length}個のタスクが高い独立性を持っています。これらは並列実行に適しています。`,
      );
    }

    if (treeMap.criticalPath.length > 3) {
      warnings.push(
        `クリティカルパスが${treeMap.criticalPath.length}タスクと長いため、全体の実行時間に影響します。`,
      );
    }

    const hasCycle = this.detectCycles();
    if (hasCycle) {
      warnings.push('循環依存が検出されました。タスクの順序を見直してください。');
    }

    // Dependencies
    const highlyDependent = Array.from(treeMap.nodes.values()).filter(
      (n) => n.independenceScore < 30,
    );
    if (highlyDependent.length > 0) {
      warnings.push(
        `${highlyDependent.length}個のタスクが高い依存性を持っています。ボトルネックになる可能性があります。`,
      );
    }

    const parallelGroups = treeMap.parallelGroups.filter(
      (g) => g.canRunParallel && g.taskIds.length > 1,
    );
    if (parallelGroups.length > 0) {
      const totalParallelTasks = parallelGroups.reduce((sum, g) => sum + g.taskIds.length, 0);
      recommendations.push(
        `${totalParallelTasks}個のタスクを${parallelGroups.length}グループで並列実行できます。`,
      );
    }

    return { recommendations, warnings };
  }

  /**
   */
  private detectCycles(): boolean {
    const visited = new Set<number>();
    const recStack = new Set<number>();

    const dfs = (nodeId: number): boolean => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependents) {
          if (!visited.has(depId)) {
            if (dfs(depId)) return true;
          } else if (recStack.has(depId)) {
            return true;
          }
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }
}

/**
 * Dependencies
 */
export function createDependencyAnalyzer(): DependencyAnalyzer {
  return new DependencyAnalyzer();
}
