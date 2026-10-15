/**
 * recall-metrics
 *
 * Aggregates `memory_recall_attempt` timeline events (written by
 * hybrid-search.ts, one per recall attempt INCLUDING empty ones) into the
 * numbers that answer "is knowledge actually reaching the agents?" — attempt
 * count, non-empty rate, and attempts per agent execution. Read-only.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('memory:recall:metrics');

/** One recall attempt as recorded by hybrid-search.ts. */
export interface RecallSample {
  source: string;
  returned: number;
  vectorCandidates: number;
  lexicalCandidates: number;
  topSimilarity: number | null;
  topLexical: number | null;
}

/** Aggregate recall metrics over a look-back window. */
export interface RecallMetrics {
  days: number;
  attempts: number;
  nonEmpty: number;
  /** nonEmpty / attempts (0 when no attempts). */
  nonEmptyRate: number;
  avgReturned: number;
  /** Mean of topSimilarity over attempts that had ≥1 vector candidate. */
  avgTopSimilarity: number | null;
  /** Mean of topLexical over attempts that had ≥1 lexical candidate. */
  avgTopLexical: number | null;
  /** Share of non-empty attempts served by the lexical channel alone. */
  lexicalOnlyShare: number;
  /** agent_execution_completed + agent_execution_failed in the window. */
  executions: number;
  /** Agent-path attempts (workflow + task_rag) per execution. */
  attemptsPerExecution: number;
  /** Agent-path NON-EMPTY attempts per execution — comparable to the old memory_retrieval / executions ratio. */
  nonEmptyPerExecution: number;
  bySource: Record<string, { attempts: number; nonEmpty: number }>;
}

/** Sources that count as "an agent asked memory for context". */
const AGENT_SOURCES = new Set(['workflow', 'task_rag']);

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Compute recall metrics from raw samples. Pure and unit-testable.
 *
 * @param samples - Parsed attempt samples. / 試行サンプル
 * @param executions - Agent executions in the same window. / 実行数
 * @param days - Window length (echoed back). / 集計日数
 * @returns Aggregate metrics (zeroes when no samples). / 集計値
 */
export function aggregateRecallMetrics(
  samples: RecallSample[],
  executions: number,
  days: number,
): RecallMetrics {
  const attempts = samples.length;
  const nonEmptySamples = samples.filter((s) => s.returned > 0);
  const agentSamples = samples.filter((s) => AGENT_SOURCES.has(s.source));
  const agentNonEmpty = agentSamples.filter((s) => s.returned > 0).length;
  const bySource: Record<string, { attempts: number; nonEmpty: number }> = {};
  for (const s of samples) {
    const b = (bySource[s.source] ??= { attempts: 0, nonEmpty: 0 });
    b.attempts += 1;
    if (s.returned > 0) b.nonEmpty += 1;
  }
  return {
    days,
    attempts,
    nonEmpty: nonEmptySamples.length,
    nonEmptyRate: attempts > 0 ? nonEmptySamples.length / attempts : 0,
    avgReturned: attempts > 0 ? samples.reduce((a, s) => a + s.returned, 0) / attempts : 0,
    avgTopSimilarity: mean(
      samples
        .filter((s) => s.vectorCandidates > 0 && s.topSimilarity !== null)
        .map((s) => s.topSimilarity as number),
    ),
    avgTopLexical: mean(
      samples
        .filter((s) => s.lexicalCandidates > 0 && s.topLexical !== null)
        .map((s) => s.topLexical as number),
    ),
    lexicalOnlyShare:
      nonEmptySamples.length > 0
        ? nonEmptySamples.filter((s) => s.vectorCandidates === 0).length / nonEmptySamples.length
        : 0,
    executions,
    attemptsPerExecution: executions > 0 ? agentSamples.length / executions : 0,
    nonEmptyPerExecution: executions > 0 ? agentNonEmpty / executions : 0,
    bySource,
  };
}

/** Parse one timeline payload into a sample. */
function toSample(payload: string): RecallSample | null {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    return {
      source: typeof p.source === 'string' ? p.source : 'unknown',
      returned: num(p.returned),
      vectorCandidates: num(p.vectorCandidates),
      lexicalCandidates: num(p.lexicalCandidates),
      topSimilarity: typeof p.topSimilarity === 'number' ? p.topSimilarity : null,
      topLexical: typeof p.topLexical === 'number' ? p.topLexical : null,
    };
  } catch {
    return null;
  }
}

/**
 * Load recall attempts and execution counts for the window and aggregate.
 * Best-effort: any failure yields the zero aggregate.
 *
 * @param days - Look-back window in days. / 集計対象期間(日)
 * @returns Recall metrics. / 想起メトリクス
 */
export async function getRecallMetrics(days = 7): Promise<RecallMetrics> {
  const gte = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const [events, executions] = await Promise.all([
      prisma.timelineEvent.findMany({
        where: { eventType: 'memory_recall_attempt', createdAt: { gte } },
        select: { payload: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      prisma.timelineEvent.count({
        where: {
          eventType: { in: ['agent_execution_completed', 'agent_execution_failed'] },
          createdAt: { gte },
        },
      }),
    ]);
    const samples = events
      .map((e) => toSample(e.payload))
      .filter((s): s is RecallSample => s !== null);
    return aggregateRecallMetrics(samples, executions, days);
  } catch (err) {
    log.warn({ err }, 'Failed to aggregate recall metrics');
    return aggregateRecallMetrics([], 0, days);
  }
}
