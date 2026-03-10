/**
 * 依存関係分析アルゴリズム
 * サブタスク間の依存関係を分析し、重みづけを行う
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
 * ファイルパスを抽出するヘルパー関数
 */
function extractFilePaths(text: string | null | undefined): string[] {
  if (!text) return [];

  const patterns = [
    // Unix/Mac パス
    /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // Windows パス
    /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // 相対パス
    /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // src/components/... 形式
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
 * ファイル名を取得
 */
function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * 優先度を数値に変換
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
 * 依存関係分析クラス
 */
export class DependencyAnalyzer {
  private nodes: Map<number, TaskNode> = new Map();
  private edges: DependencyEdge[] = [];

  constructor() {}

  /**
   * 依存関係を分析してツリーマップを生成
   */
  analyze(input: DependencyAnalysisInput): DependencyAnalysisResult {
    this.nodes.clear();
    this.edges = [];

    // ノードを初期化
    this.initializeNodes(input);

    // 依存関係エッジを計算
    this.calculateDependencyEdges();

    // グラフの深さと独立性スコアを計算
    this.calculateNodeMetrics();

    // 並列実行グループを生成
    const parallelGroups = this.generateParallelGroups();

    // クリティカルパスを計算
    const criticalPath = this.calculateCriticalPath();

    // ツリーマップを構築
    const treeMap: DependencyTreeMap = {
      nodes: this.nodes,
      edges: this.edges,
      criticalPath,
      parallelGroups,
      maxDepth: this.calculateMaxDepth(),
      totalWeight: this.calculateTotalWeight(),
    };

    // 実行プランを生成
    const plan = this.generateExecutionPlan(input.parentTaskId, treeMap, input.config);

    // 推奨事項と警告を生成
    const { recommendations, warnings } = this.generateRecommendations(treeMap);

    return {
      treeMap,
      plan,
      recommendations,
      warnings,
    };
  }

  /**
   * ノードを初期化
   */
  private initializeNodes(input: DependencyAnalysisInput): void {
    for (const subtask of input.subtasks) {
      // 説明からファイルを抽出
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

    // 明示的な依存関係から dependents を設定
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
   * 依存関係エッジを計算
   */
  private calculateDependencyEdges(): void {
    const nodeArray = Array.from(this.nodes.values());

    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const node1 = nodeArray[i];
        const node2 = nodeArray[j];

        // ファイル共有による依存関係を検出
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

          // 双方向の依存として追加（ファイル共有の場合）
          if (!node1.dependencies.includes(node2.id)) {
            // 優先度が高いタスクが先に実行されるべき
            if (priorityToWeight(node1.priority) < priorityToWeight(node2.priority)) {
              node1.dependencies.push(node2.id);
              node2.dependents.push(node1.id);
            }
          }
        }

        // 明示的な順序依存
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
   * 共有ファイルを検出
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
   * ファイル共有の重みを計算
   */
  private calculateFileSharingWeight(
    node1: TaskNode,
    node2: TaskNode,
    sharedFiles: string[],
  ): number {
    const node1FileCount = node1.files.length || 1;
    const node2FileCount = node2.files.length || 1;

    // 共有ファイルの割合を計算
    const ratio1 = sharedFiles.length / node1FileCount;
    const ratio2 = sharedFiles.length / node2FileCount;
    const avgRatio = (ratio1 + ratio2) / 2;

    // 重要なファイルタイプの重みを増加
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
   * ノードのメトリクスを計算
   */
  private calculateNodeMetrics(): void {
    // トポロジカルソートで深さを計算
    const visited = new Set<number>();
    const depths = new Map<number, number>();

    const calculateDepth = (nodeId: number): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // 循環依存を回避

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

    // 各ノードの深さを計算
    for (const nodeId of this.nodes.keys()) {
      const depth = calculateDepth(nodeId);
      const node = this.nodes.get(nodeId)!;
      node.depth = depth;

      // 独立性スコアを計算
      const totalEdgeWeight = this.edges
        .filter((e) => e.fromTaskId === nodeId || e.toTaskId === nodeId)
        .reduce((sum, e) => sum + e.weight, 0);

      const maxPossibleWeight = this.nodes.size * 100;
      node.independenceScore = Math.max(
        0,
        100 - Math.round((totalEdgeWeight / maxPossibleWeight) * 100),
      );

      // 並列実行可能性スコアを計算
      const dependencyCount = node.dependencies.length;
      const dependentCount = node.dependents.length;
      const connectionRatio = (dependencyCount + dependentCount) / (this.nodes.size - 1);
      node.parallelizability = Math.max(0, Math.round(100 - connectionRatio * 50));
    }
  }

  /**
   * 並列実行グループを生成
   */
  private generateParallelGroups(): ParallelGroup[] {
    const groups: ParallelGroup[] = [];
    const assigned = new Set<number>();

    // レベル（深さ）ごとにグループ化
    const maxDepth = this.calculateMaxDepth();

    for (let level = 0; level <= maxDepth; level++) {
      const levelTasks: number[] = [];

      for (const node of this.nodes.values()) {
        if (node.depth === level && !assigned.has(node.id)) {
          // 依存タスクがすべて完了している（より低いレベル）か確認
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
        // グループ内の依存関係を検出
        const internalDeps = this.edges.filter(
          (e) => levelTasks.includes(e.fromTaskId) && levelTasks.includes(e.toTaskId),
        );

        // グループ間の依存を計算
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

        // 推定実行時間を計算（並列実行の場合は最長タスクの時間）
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
   * クリティカルパスを計算
   */
  private calculateCriticalPath(): number[] {
    const distances = new Map<number, number>();
    const predecessors = new Map<number, number | null>();

    // 初期化
    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, -Infinity);
      predecessors.set(nodeId, null);
    }

    // 開始ノード（依存のないノード）を見つける
    const startNodes = Array.from(this.nodes.values())
      .filter((n) => n.dependencies.length === 0)
      .map((n) => n.id);

    for (const startId of startNodes) {
      distances.set(startId, this.nodes.get(startId)?.estimatedHours || 0);
    }

    // トポロジカル順序で処理
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

    // 最長パスの終点を見つける
    let maxDist = -Infinity;
    let endNode: number | null = null;
    for (const [nodeId, dist] of distances) {
      if (dist > maxDist) {
        maxDist = dist;
        endNode = nodeId;
      }
    }

    // パスを逆順にたどる
    const path: number[] = [];
    let current = endNode;
    while (current !== null) {
      path.unshift(current);
      current = predecessors.get(current) || null;
    }

    return path;
  }

  /**
   * トポロジカルソート
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
   * 最大深さを計算
   */
  private calculateMaxDepth(): number {
    let maxDepth = 0;
    for (const node of this.nodes.values()) {
      maxDepth = Math.max(maxDepth, node.depth);
    }
    return maxDepth;
  }

  /**
   * 総重みを計算
   */
  private calculateTotalWeight(): number {
    return this.edges.reduce((sum, e) => sum + e.weight, 0);
  }

  /**
   * 実行プランを生成
   */
  private generateExecutionPlan(
    parentTaskId: number,
    treeMap: DependencyTreeMap,
    config?: Partial<{ maxConcurrentAgents: number }>,
  ): ParallelExecutionPlan {
    const maxConcurrency = config?.maxConcurrentAgents || 3;

    // 実行順序を生成（レベルごと）
    const executionOrder: number[][] = [];
    for (const group of treeMap.parallelGroups) {
      // maxConcurrencyに合わせてグループを分割
      const tasks = [...group.taskIds];
      while (tasks.length > 0) {
        const batch = tasks.splice(0, maxConcurrency);
        executionOrder.push(batch);
      }
    }

    // リソース制約を検出
    const resourceConstraints = this.detectResourceConstraints();

    // 推定時間を計算
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
   * リソース制約を検出
   */
  private detectResourceConstraints(): ResourceConstraint[] {
    const constraints: ResourceConstraint[] = [];
    const fileUsage = new Map<string, number[]>();

    // ファイル使用状況を収集
    for (const node of this.nodes.values()) {
      for (const file of node.files) {
        const fileName = getFileName(file);
        if (!fileUsage.has(fileName)) {
          fileUsage.set(fileName, []);
        }
        fileUsage.get(fileName)!.push(node.id);
      }
    }

    // 複数タスクで使用されるファイルを制約として追加
    for (const [fileName, taskIds] of fileUsage) {
      if (taskIds.length > 1) {
        // 重要なファイルは同時実行を制限
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
   * 推奨事項と警告を生成
   */
  private generateRecommendations(treeMap: DependencyTreeMap): {
    recommendations: string[];
    warnings: string[];
  } {
    const recommendations: string[] = [];
    const warnings: string[] = [];

    // 独立性の高いタスクを推奨
    const highlyIndependent = Array.from(treeMap.nodes.values()).filter(
      (n) => n.independenceScore >= 80,
    );
    if (highlyIndependent.length > 0) {
      recommendations.push(
        `${highlyIndependent.length}個のタスクが高い独立性を持っています。これらは並列実行に適しています。`,
      );
    }

    // クリティカルパスの警告
    if (treeMap.criticalPath.length > 3) {
      warnings.push(
        `クリティカルパスが${treeMap.criticalPath.length}タスクと長いため、全体の実行時間に影響します。`,
      );
    }

    // 循環依存の警告
    const hasCycle = this.detectCycles();
    if (hasCycle) {
      warnings.push('循環依存が検出されました。タスクの順序を見直してください。');
    }

    // 高い依存関係の警告
    const highlyDependent = Array.from(treeMap.nodes.values()).filter(
      (n) => n.independenceScore < 30,
    );
    if (highlyDependent.length > 0) {
      warnings.push(
        `${highlyDependent.length}個のタスクが高い依存性を持っています。ボトルネックになる可能性があります。`,
      );
    }

    // 並列化の効果
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
   * 循環依存を検出
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
 * 依存関係分析のファクトリー関数
 */
export function createDependencyAnalyzer(): DependencyAnalyzer {
  return new DependencyAnalyzer();
}
