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
import { SSEStreamController, getUserFriendlyErrorMessage } from '../../../services/communication/sse-utils';
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
  );
