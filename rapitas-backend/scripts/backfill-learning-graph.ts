#!/usr/bin/env bun
/**
 * backfill-learning-graph.ts
 *
 * One-shot backfill for the agent-memory page's dead metrics: recomputes each
 * historical Experiment's confidence from its task's real WorkflowTransition
 * gate history (they were all hardcoded 0.8/0.2), and re-derives the diverse
 * knowledge-graph nodes (technology / pattern / problem / solution) that the
 * recorder only started writing on 2026-07-16. Deliberately does NOT touch
 * episodes — re-recording them would duplicate episodic memory.
 *
 * Idempotent: experiment updates are recomputations, addNode upserts by
 * (label, nodeType). Safe to re-run.
 *
 * Usage: bun scripts/backfill-learning-graph.ts [--dry-run]
 *
 * NOTE: Run AFTER a server (re)start. The shared generated Prisma client can
 * carry the desktop's sqlite provider (provider drift); dev.js regenerates the
 * correct client on startup, and this script needs that client to connect.
 */
import { prisma } from '../config/database';
import { addNode, addEdge } from '../services/self-learning/knowledge-graph';
import {
  deriveOutcomeConfidence,
  extractTechLabels,
  taskTypeLabel,
} from '../services/self-learning/task-learning-recorder';
import type { KnowledgeNodeType } from '../services/self-learning/types';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const experiments = await prisma.experiment.findMany({
    where: { taskId: { not: null }, status: { in: ['completed', 'failed'] } },
    select: { id: true, taskId: true, title: true, status: true, confidence: true },
  });
  console.log(
    `[backfill] ${experiments.length} terminal experiments to examine${dryRun ? ' (dry-run)' : ''}`,
  );

  let confidenceUpdates = 0;
  let nodesWritten = 0;

  for (const exp of experiments) {
    const success = exp.status === 'completed';
    const { confidence, troubleCauses } = await deriveOutcomeConfidence(exp.taskId!, success);

    if (Math.abs(confidence - exp.confidence) > 0.001) {
      confidenceUpdates++;
      if (!dryRun) {
        await prisma.experiment.update({ where: { id: exp.id }, data: { confidence } });
      }
    }

    const title = exp.title ?? '';
    const task = await prisma.task.findUnique({
      where: { id: exp.taskId! },
      select: { workflowMode: true },
    });

    const nodes: Array<{
      label: string;
      nodeType: KnowledgeNodeType;
      description: string;
      weight: number;
    }> = [
      {
        label: taskTypeLabel(title),
        nodeType: 'concept' as const,
        description: `タスク種別「${taskTypeLabel(title)}」`,
        weight: success ? 0.2 : 0.1,
      },
      ...extractTechLabels(title).map((tech) => ({
        label: tech,
        nodeType: 'technology' as const,
        description: `技術要素「${tech}」`,
        weight: success ? 0.15 : 0.05,
      })),
      ...(task?.workflowMode
        ? [
            {
              label: `mode:${task.workflowMode}`,
              nodeType: 'pattern' as const,
              description: `ワークフローモード「${task.workflowMode}」での実行`,
              weight: success ? 0.15 : 0.05,
            },
          ]
        : []),
      ...troubleCauses.slice(0, 3).map((cause) => ({
        label: cause,
        nodeType: 'problem' as const,
        description: `検証ゲート却下要因「${cause}」`,
        weight: 0.15,
      })),
      ...(success && troubleCauses.length > 0
        ? [
            {
              label: 'self_repair_recovery',
              nodeType: 'solution' as const,
              description: '検証ゲート却下から自己修復して完了',
              weight: 0.2,
            },
          ]
        : []),
    ];

    if (!dryRun) {
      // Mirror the recorder's edge writing so historical correlations arm the
      // implementer's pitfall warning immediately instead of weeks from now.
      const created = [] as Array<{ id: number; nodeType: string }>;
      for (const node of nodes) {
        nodesWritten++;
        created.push({ id: (await addNode(node)).id, nodeType: node.nodeType });
      }
      const concepts = created.filter((n) => n.nodeType === 'concept');
      const techs = created.filter((n) => n.nodeType === 'technology');
      const problems = created.filter((n) => n.nodeType === 'problem');
      const solutions = created.filter((n) => n.nodeType === 'solution');
      for (const problem of problems) {
        for (const src of [...concepts, ...techs]) {
          await addEdge({
            fromNodeId: src.id,
            toNodeId: problem.id,
            edgeType: 'causes',
            weight: src.nodeType === 'concept' ? 0.2 : 0.15,
          });
        }
        for (const sol of solutions) {
          await addEdge({
            fromNodeId: sol.id,
            toNodeId: problem.id,
            edgeType: 'solves',
            weight: 0.2,
          });
        }
      }
    } else {
      nodesWritten += nodes.length;
    }
  }

  console.log(
    `[backfill] done — confidence updated: ${confidenceUpdates}/${experiments.length}, node upserts: ${nodesWritten}`,
  );

  const distribution = await prisma.knowledgeGraphNode.groupBy({
    by: ['nodeType'],
    _count: { nodeType: true },
  });
  console.log(
    '[backfill] node distribution now:',
    JSON.stringify(distribution.map((d) => ({ type: d.nodeType, count: d._count.nodeType }))),
  );
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
