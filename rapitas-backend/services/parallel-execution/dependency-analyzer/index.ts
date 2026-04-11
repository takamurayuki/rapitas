/**
 * DependencyAnalyzer
 *
 * Analyses a set of subtasks to build a dependency tree, compute parallel
 * execution groups, and generate a resource-aware execution plan.
 * Not responsible for raw graph algorithms (see graph-algorithms.ts),
 * file-path extraction utilities (see utils.ts), or plan construction
 * (see plan-builder.ts).
 */

import type {
  TaskNode,
  DependencyEdge,
  DependencyAnalysisInput,
  DependencyAnalysisResult,
  DependencyTreeMap,
} from '../types-dir/types';

import { extractFilePaths, getFileName, priorityToWeight } from './utils';
import {
  calculateCriticalPath,
  generateParallelGroups,
  detectCycles,
  calculateMaxDepth,
} from './graph-algorithms';
import { buildExecutionPlan } from './plan-builder';

/**
 * Stateful analyser that builds and evaluates a subtask dependency graph.
 */
export class DependencyAnalyzer {
  private nodes: Map<number, TaskNode> = new Map();
  private edges: DependencyEdge[] = [];

  constructor() {}

  /**
   * Analyse a set of subtasks and return a full dependency analysis result.
   *
   * @param input - Subtasks and configuration to analyse / 分析対象のサブタスクと設定
   * @returns Complete dependency analysis result / 依存関係分析結果
   */
  analyze(input: DependencyAnalysisInput): DependencyAnalysisResult {
    this.nodes.clear();
    this.edges = [];

    this.initializeNodes(input);
    this.calculateDependencyEdges();
    this.calculateNodeMetrics();

    const parallelGroups = generateParallelGroups(this.nodes, this.edges);
    const criticalPath = calculateCriticalPath(this.nodes);

    const treeMap: DependencyTreeMap = {
      nodes: this.nodes,
      edges: this.edges,
      criticalPath,
      parallelGroups,
      maxDepth: calculateMaxDepth(this.nodes),
      totalWeight: this.edges.reduce((sum, e) => sum + e.weight, 0),
    };

    const plan = buildExecutionPlan(input.parentTaskId, treeMap, this.nodes, input.config);
    const { recommendations, warnings } = this.generateRecommendations(treeMap);

    return { treeMap, plan, recommendations, warnings };
  }

  /**
   * Build the initial node map from the input subtasks.
   * Also resolves explicit dependency back-links (dependents arrays).
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

    // Populate dependents from the declared dependency lists
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
   * Detect implicit file-sharing and explicit sequential edges between nodes.
   */
  private calculateDependencyEdges(): void {
    const nodeArray = Array.from(this.nodes.values());

    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const node1 = nodeArray[i];
        const node2 = nodeArray[j];

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

  /** Return the basenames shared between two nodes' file lists. */
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
   * Compute a coupling weight for two nodes that share files.
   * Index and schema files are weighted more heavily as they tend to cause
   * merge conflicts.
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
      // NOTE: index.* and schema.* files have the highest collision risk
      if (file.match(/index\./)) typeWeight = Math.max(typeWeight, 1.5);
      if (file.match(/schema\./)) typeWeight = Math.max(typeWeight, 1.5);
    }

    return Math.round(avgRatio * 100 * typeWeight);
  }

  /**
   * Compute per-node depth, independence score, and parallelizability score.
   */
  private calculateNodeMetrics(): void {
    const visited = new Set<number>();
    const depths = new Map<number, number>();

    const calculateDepth = (nodeId: number): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // Guard against circular dependency infinite recursion

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

      const totalEdgeWeight = this.edges
        .filter((e) => e.fromTaskId === nodeId || e.toTaskId === nodeId)
        .reduce((sum, e) => sum + e.weight, 0);

      const maxPossibleWeight = this.nodes.size * 100;
      node.independenceScore = Math.max(
        0,
        100 - Math.round((totalEdgeWeight / maxPossibleWeight) * 100),
      );

      const dependencyCount = node.dependencies.length;
      const dependentCount = node.dependents.length;
      const connectionRatio = (dependencyCount + dependentCount) / (this.nodes.size - 1);
      node.parallelizability = Math.max(0, Math.round(100 - connectionRatio * 50));
    }
  }

  /**
   * Generate human-readable recommendations and warnings from the tree map.
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

    if (detectCycles(this.nodes)) {
      warnings.push('循環依存が検出されました。タスクの順序を見直してください。');
    }

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
}

/**
 * Create a new DependencyAnalyzer instance.
 *
 * @returns A fresh DependencyAnalyzer / 新しいDependencyAnalyzerインスタンス
 */
export function createDependencyAnalyzer(): DependencyAnalyzer {
  return new DependencyAnalyzer();
}
