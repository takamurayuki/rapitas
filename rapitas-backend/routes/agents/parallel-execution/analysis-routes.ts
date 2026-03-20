/**
 * AnalysisRoutes
 *
 * Elysia route handlers for dependency analysis endpoints:
 * - GET /parallel/tasks/:id/analyze
 * - GET /parallel/tasks/:id/analyze/stream
 * - GET /parallel/dependency-graph
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../../config';
import {
  createDependencyAnalyzer,
  type TaskPriority,
} from '../../../services/parallel-execution';
import { SSEStreamController, getUserFriendlyErrorMessage } from '../../../services/sse-utils';
import { prisma } from '../../../config/database';
import { buildAnalysisInput, extractFilePaths } from './analysis-helpers';

const log = createLogger('routes:parallel-execution:analysis');

export const analysisRoutes = new Elysia()
  /**
   * Analyze dependencies and retrieve a tree map.
   */
  .get(
    '/tasks/:id/analyze',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);
        const input = await buildAnalysisInput(taskId);

        const analyzer = createDependencyAnalyzer();
        const result = analyzer.analyze(input);

        const nodes = Array.from(result.treeMap.nodes.entries()).map(([_id, node]) => ({
          ...node,
        }));

        return {
          success: true,
          data: {
            parentTaskId: taskId,
            subtaskCount: input.subtasks.length,
            nodes,
            edges: result.treeMap.edges,
            criticalPath: result.treeMap.criticalPath,
            parallelGroups: result.treeMap.parallelGroups,
            maxDepth: result.treeMap.maxDepth,
            plan: {
              id: result.plan.id,
              executionOrder: result.plan.executionOrder,
              estimatedTotalDuration: result.plan.estimatedTotalDuration,
              estimatedSequentialDuration: result.plan.estimatedSequentialDuration,
              parallelEfficiency: result.plan.parallelEfficiency,
              maxConcurrency: result.plan.maxConcurrency,
              resourceConstraints: result.plan.resourceConstraints,
            },
            recommendations: result.recommendations,
            warnings: result.warnings,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  /**
   * Analyze dependencies via SSE stream.
   */
  .get(
    '/tasks/:id/analyze/stream',
    async (context) => {
      const { params, set } = context;
      const taskId = parseInt(params.id);

      set.headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
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
          sseController.sendStart({ taskId });
          sseController.sendProgress(10, 'Fetching task information...');

          const input = await buildAnalysisInput(taskId);
          sseController.sendProgress(30, 'Analyzing dependencies...');

          const analyzer = createDependencyAnalyzer();
          const result = analyzer.analyze(input);
          sseController.sendProgress(70, 'Generating tree map...');

          const nodes = Array.from(result.treeMap.nodes.entries()).map(([_id, node]) => ({
            ...node,
          }));

          sseController.sendProgress(90, 'Compiling results...');

          sseController.sendData({
            parentTaskId: taskId,
            subtaskCount: input.subtasks.length,
            nodes,
            edges: result.treeMap.edges,
            criticalPath: result.treeMap.criticalPath,
            parallelGroups: result.treeMap.parallelGroups,
            maxDepth: result.treeMap.maxDepth,
            plan: {
              id: result.plan.id,
              executionOrder: result.plan.executionOrder,
              estimatedTotalDuration: result.plan.estimatedTotalDuration,
              estimatedSequentialDuration: result.plan.estimatedSequentialDuration,
              parallelEfficiency: result.plan.parallelEfficiency,
              maxConcurrency: result.plan.maxConcurrency,
            },
            recommendations: result.recommendations,
            warnings: result.warnings,
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
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  /**
   * Analyze cross-task dependency graph for a theme or set of tasks.
   * Returns nodes and edges suitable for visualization (React Flow, D3, etc.).
   */
  .get(
    '/dependency-graph',
    async (context) => {
      const { query } = context;
      try {
        const themeId = query.themeId ? parseInt(query.themeId) : undefined;
        const status = query.status || undefined;

        const where: Record<string, unknown> = { parentId: null };
        if (themeId) where.themeId = themeId;
        if (status) where.status = status;

        const tasks = await prisma.task.findMany({
          where,
          include: {
            subtasks: { select: { id: true, title: true, status: true } },
            prompts: { select: { optimizedPrompt: true, originalDescription: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: parseInt(query.limit || '50'),
        });

        if (tasks.length === 0) {
          return { success: true, data: { nodes: [], edges: [], groups: [] } };
        }

        type SubtaskEntry = {
          id: number;
          title: string;
          description?: string;
          priority: TaskPriority;
          estimatedHours?: number;
          files?: string[];
          explicitDependencies?: number[];
        };

        const subtaskList: SubtaskEntry[] = [];
        for (const t of tasks) {
          if (t.subtasks.length > 0) {
            for (const s of t.subtasks) {
              subtaskList.push({ id: s.id, title: s.title, priority: 'medium' });
            }
          } else {
            const files = extractFilePaths(t.description);
            for (const p of t.prompts) {
              files.push(...extractFilePaths(p.optimizedPrompt));
              files.push(...extractFilePaths(p.originalDescription));
            }
            subtaskList.push({
              id: t.id,
              title: t.title,
              description: t.description || undefined,
              priority: (t.priority || 'medium') as TaskPriority,
              estimatedHours: t.estimatedHours || 1,
              files: [...new Set(files)],
            });
          }
        }

        if (subtaskList.length < 2) {
          const n = subtaskList[0];
          return {
            success: true,
            data: {
              nodes: n
                ? [
                    {
                      id: n.id,
                      title: n.title,
                      depth: 0,
                      independenceScore: 100,
                      parallelizability: 100,
                      status: 'pending',
                      files: n.files || [],
                    },
                  ]
                : [],
              edges: [],
              groups: [],
            },
          };
        }

        // Deduplicate by ID
        const uniqueMap = new Map<number, SubtaskEntry>();
        for (const s of subtaskList) uniqueMap.set(s.id, s);

        const analyzer = createDependencyAnalyzer();
        const result = analyzer.analyze({
          parentTaskId: themeId || 0,
          subtasks: [...uniqueMap.values()],
        });

        const nodes = Array.from(result.treeMap.nodes.entries()).map(([, node]) => ({
          id: node.id,
          title: node.title,
          depth: node.depth,
          independenceScore: node.independenceScore,
          parallelizability: node.parallelizability,
          status: node.status,
          files: node.files,
        }));

        return {
          success: true,
          data: {
            nodes,
            edges: result.treeMap.edges,
            criticalPath: result.treeMap.criticalPath,
            groups: result.treeMap.parallelGroups,
            maxDepth: result.treeMap.maxDepth,
            plan: {
              parallelEfficiency: result.plan.parallelEfficiency,
              estimatedTotalDuration: result.plan.estimatedTotalDuration,
              maxConcurrency: result.plan.maxConcurrency,
            },
            recommendations: result.recommendations,
            warnings: result.warnings,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[DependencyGraph] Analysis failed');
        return { success: false, error: errorMessage };
      }
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  );
