/**
 * Task Dependency Analysis API Routes
 * Provides task dependency analysis and visualization
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import {
  SSEStreamController,
  getUserFriendlyErrorMessage,
} from "../services/sse-utils";

// Type definitions
type SubtaskFileInfo = {
  id: number;
  title: string;
  files: string[];
  fileNames: string[];
};

type DependencyInfo = {
  taskId: number;
  title: string;
  files: string[];
  dependencies: Array<{
    taskId: number;
    title: string;
    sharedFiles: string[];
    dependencyScore: number;
  }>;
  independenceScore: number;
  canRunParallel: boolean;
};

type TreeNode = {
  id: number;
  title: string;
  files: string[];
  independenceScore: number;
  canRunParallel: boolean;
  level: number;
  children: TreeNode[];
  dependsOn: Array<{ id: number; title: string; sharedFiles: string[] }>;
};

// Helper functions
const extractFilePaths = (text: string | null): string[] => {
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
      const filePath = match[1]
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .toLowerCase();

      if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
};

const getFileName = (path: string): string => {
  const parts = path.split("/");
  return parts[parts.length - 1];
};

const calculateDependencies = (
  subtaskFiles: SubtaskFileInfo[],
): DependencyInfo[] => {
  const dependencyAnalysis: DependencyInfo[] = [];

  for (const current of subtaskFiles) {
    const dependencies: DependencyInfo["dependencies"] = [];

    for (const other of subtaskFiles) {
      if (current.id === other.id) continue;

      const sharedFiles = current.fileNames.filter((fn) =>
        other.fileNames.includes(fn),
      );

      if (sharedFiles.length > 0) {
        const score =
          current.files.length > 0
            ? Math.round((sharedFiles.length / current.files.length) * 100)
            : 0;

        dependencies.push({
          taskId: other.id,
          title: other.title,
          sharedFiles,
          dependencyScore: score,
        });
      }
    }

    const totalSharedFiles = new Set(
      dependencies.flatMap((d) => d.sharedFiles),
    ).size;
    const independenceScore =
      current.files.length > 0
        ? Math.round(
            ((current.files.length - totalSharedFiles) / current.files.length) *
              100,
          )
        : 100;

    dependencyAnalysis.push({
      taskId: current.id,
      title: current.title,
      files: current.files,
      dependencies: dependencies.sort(
        (a, b) => b.dependencyScore - a.dependencyScore,
      ),
      independenceScore,
      canRunParallel: dependencies.length === 0 || independenceScore >= 70,
    });
  }

  return dependencyAnalysis;
};

const buildTree = (dependencyAnalysis: DependencyInfo[]): TreeNode[] => {
  const sortedTasks = [...dependencyAnalysis].sort(
    (a, b) => b.independenceScore - a.independenceScore,
  );

  const nodes: TreeNode[] = [];
  const processed = new Set<number>();

  for (const task of sortedTasks) {
    if (processed.has(task.taskId)) continue;

    const node: TreeNode = {
      id: task.taskId,
      title: task.title,
      files: task.files,
      independenceScore: task.independenceScore,
      canRunParallel: task.canRunParallel,
      level: 0,
      children: [],
      dependsOn: task.dependencies.map((d) => ({
        id: d.taskId,
        title: d.title,
        sharedFiles: d.sharedFiles,
      })),
    };

    for (const dep of task.dependencies) {
      if (!processed.has(dep.taskId)) {
        const depTask = sortedTasks.find((t) => t.taskId === dep.taskId);
        if (depTask) {
          node.children.push({
            id: depTask.taskId,
            title: depTask.title,
            files: depTask.files,
            independenceScore: depTask.independenceScore,
            canRunParallel: depTask.canRunParallel,
            level: 1,
            children: [],
            dependsOn: depTask.dependencies.map((d) => ({
              id: d.taskId,
              title: d.title,
              sharedFiles: d.sharedFiles,
            })),
          });
          processed.add(depTask.taskId);
        }
      }
    }

    nodes.push(node);
    processed.add(task.taskId);
  }

  return nodes;
};

export const taskDependencyRoutes = new Elysia()
  // Task dependency analysis (file-sharing based)
  .get(
    "/tasks/:id/dependency-analysis", async ({  params  }: any) => {
      const taskIdNum = parseInt(params.id);

      const task = await prisma.task.findUnique({
        where: { id: taskIdNum },
        include: {
          subtasks: {
            include: {
              prompts: true,
            },
          },
          prompts: true,
        },
      });

      if (!task) {
        return { error: "タスクが見つかりません" };
      }

      const subtaskFiles: SubtaskFileInfo[] = [];

      if (task.subtasks.length === 0) {
        const parentFiles: string[] = [];
        for (const prompt of task.prompts) {
          parentFiles.push(...extractFilePaths(prompt.optimizedPrompt));
          parentFiles.push(...extractFilePaths(prompt.originalDescription));
        }
        parentFiles.push(...extractFilePaths(task.description));

        const uniqueFiles = Array.from(new Set(parentFiles));
        subtaskFiles.push({
          id: task.id,
          title: task.title,
          files: uniqueFiles,
          fileNames: uniqueFiles.map(getFileName),
        });
      } else {
        for (const subtask of task.subtasks) {
          const files: string[] = [];

          for (const prompt of subtask.prompts) {
            files.push(...extractFilePaths(prompt.optimizedPrompt));
            files.push(...extractFilePaths(prompt.originalDescription));
          }
          files.push(...extractFilePaths(subtask.description));

          const uniqueFiles = Array.from(new Set(files));
          subtaskFiles.push({
            id: subtask.id,
            title: subtask.title,
            files: uniqueFiles,
            fileNames: uniqueFiles.map(getFileName),
          });
        }
      }

      const dependencyAnalysis = calculateDependencies(subtaskFiles);
      const tree = buildTree(dependencyAnalysis);

      const independentTasks = dependencyAnalysis.filter(
        (t) => t.canRunParallel,
      );
      const dependentTasks = dependencyAnalysis.filter(
        (t) => !t.canRunParallel,
      );

      const parallelGroups: Array<{
        groupId: number;
        tasks: Array<{ id: number; title: string }>;
        canRunTogether: boolean;
      }> = [];

      if (independentTasks.length > 0) {
        parallelGroups.push({
          groupId: 1,
          tasks: independentTasks.map((t) => ({ id: t.taskId, title: t.title })),
          canRunTogether: true,
        });
      }

      if (dependentTasks.length > 0) {
        parallelGroups.push({
          groupId: 2,
          tasks: dependentTasks.map((t) => ({ id: t.taskId, title: t.title })),
          canRunTogether: false,
        });
      }

      return {
        taskId: task.id,
        taskTitle: task.title,
        hasSubtasks: task.subtasks.length > 0,
        subtaskCount: task.subtasks.length,
        analysis: dependencyAnalysis,
        tree,
        parallelGroups,
        summary: {
          totalTasks: subtaskFiles.length,
          independentTasks: independentTasks.length,
          dependentTasks: dependentTasks.length,
          totalFiles: new Set(subtaskFiles.flatMap((t) => t.files)).size,
          averageIndependence: Math.round(
            dependencyAnalysis.reduce((sum, t) => sum + t.independenceScore, 0) /
              dependencyAnalysis.length || 0,
          ),
        },
      };
    },
  )

  // SSE-based dependency analysis stream
  .get(
    "/tasks/:id/dependency-analysis/stream", async ({  params, set  }: any) => {
      const taskIdNum = parseInt(params.id);

      set.headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      const sseController = new SSEStreamController({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
      });

      const stream = sseController.createStream();

      (async () => {
        try {
          sseController.sendStart({ taskId: taskIdNum });
          sseController.saveState({ taskId: taskIdNum, status: "pending" });
          sseController.sendProgress(10, "タスク情報を取得中...");

          const task = await sseController.executeWithRetry(async () => {
            const result = await prisma.task.findUnique({
              where: { id: taskIdNum },
              include: {
                subtasks: {
                  include: {
                    prompts: true,
                  },
                },
                prompts: true,
              },
            });
            if (!result) {
              throw new Error("タスクが見つかりません");
            }
            return result;
          });

          sseController.sendProgress(30, "ファイル情報を抽出中...");

          const subtaskFiles: SubtaskFileInfo[] = [];

          if (task.subtasks.length === 0) {
            const parentFiles: string[] = [];
            for (const prompt of task.prompts) {
              parentFiles.push(...extractFilePaths(prompt.optimizedPrompt));
              parentFiles.push(...extractFilePaths(prompt.originalDescription));
            }
            parentFiles.push(...extractFilePaths(task.description));
            const uniqueFiles = Array.from(new Set(parentFiles));
            subtaskFiles.push({
              id: task.id,
              title: task.title,
              files: uniqueFiles,
              fileNames: uniqueFiles.map(getFileName),
            });
          } else {
            for (let i = 0; i < task.subtasks.length; i++) {
              const subtask = task.subtasks[i];
              const files: string[] = [];
              for (const prompt of subtask.prompts) {
                files.push(...extractFilePaths(prompt.optimizedPrompt));
                files.push(...extractFilePaths(prompt.originalDescription));
              }
              files.push(...extractFilePaths(subtask.description));
              const uniqueFiles = Array.from(new Set(files));
              subtaskFiles.push({
                id: subtask.id,
                title: subtask.title,
                files: uniqueFiles,
                fileNames: uniqueFiles.map(getFileName),
              });

              const progress = 30 + Math.round((i / task.subtasks.length) * 30);
              sseController.sendProgress(
                progress,
                `サブタスク ${i + 1}/${task.subtasks.length} を分析中...`,
              );
            }
          }

          sseController.sendProgress(60, "依存関係を分析中...");

          const dependencyAnalysis = calculateDependencies(subtaskFiles);

          sseController.sendProgress(80, "ツリー構造を生成中...");

          const tree = buildTree(dependencyAnalysis);

          sseController.sendProgress(90, "結果をまとめています...");

          const independentTasks = dependencyAnalysis.filter(
            (t) => t.canRunParallel,
          );
          const dependentTasks = dependencyAnalysis.filter(
            (t) => !t.canRunParallel,
          );

          const parallelGroups: Array<{
            groupId: number;
            tasks: Array<{ id: number; title: string }>;
            canRunTogether: boolean;
          }> = [];
          if (independentTasks.length > 0) {
            parallelGroups.push({
              groupId: 1,
              tasks: independentTasks.map((t) => ({
                id: t.taskId,
                title: t.title,
              })),
              canRunTogether: true,
            });
          }
          if (dependentTasks.length > 0) {
            parallelGroups.push({
              groupId: 2,
              tasks: dependentTasks.map((t) => ({
                id: t.taskId,
                title: t.title,
              })),
              canRunTogether: false,
            });
          }

          sseController.sendData({
            taskId: task.id,
            taskTitle: task.title,
            hasSubtasks: task.subtasks.length > 0,
            subtaskCount: task.subtasks.length,
            analysis: dependencyAnalysis,
            tree,
            parallelGroups,
            summary: {
              totalTasks: subtaskFiles.length,
              independentTasks: independentTasks.length,
              dependentTasks: dependentTasks.length,
              totalFiles: new Set(subtaskFiles.flatMap((t) => t.files)).size,
              averageIndependence: Math.round(
                dependencyAnalysis.reduce(
                  (sum, t) => sum + t.independenceScore,
                  0,
                ) / (dependencyAnalysis.length || 1),
              ),
            },
          });

          sseController.sendComplete({ success: true });
        } catch (error) {
          const errorMessage = getUserFriendlyErrorMessage(error);
          sseController.sendError(errorMessage, {
            originalError: error instanceof Error ? error.message : String(error),
          });
        } finally {
          sseController.close();
        }
      })();

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
  );
