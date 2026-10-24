/**
 * Gate Precision Route
 *
 * Read-only view of the gate-precision ledger: how the gates' repeated
 * bounces resolved. Not responsible for producing the rows — see
 * services/self-improvement/gate-precision-ledger, run by the
 * `gate_precision` backlog job.
 *
 * The ledger existed and was read only by agent prompts, so the one question
 * the review gate leaves open — how many of its fails had something to act
 * on — needed a throwaway query to answer. This makes it readable.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import {
  summariseGatePrecision,
  type PrecisionRow,
} from '../../../services/self-improvement/gate-precision-summary';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound for ?windowDays= so a typo cannot scan the whole history. */
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 90;

export const gatePrecisionRoutes = new Elysia().get(
  '/agents/gate-precision',
  async ({ query }) => {
    const requested = query.windowDays !== undefined ? Number(query.windowDays) : NaN;
    const windowDays =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_WINDOW_DAYS)
        : DEFAULT_WINDOW_DAYS;

    const rows = (await prisma.gatePrecisionCase.findMany({
      where: { createdAt: { gte: new Date(Date.now() - windowDays * DAY_MS) } },
      select: { gate: true, verdict: true, reason: true, taskId: true },
    })) as PrecisionRow[];

    return {
      windowDays,
      ...summariseGatePrecision(rows),
      // Said in the payload, not only in the docs: a consumer reading
      // `actionableShare` has no other way to know there is no ground truth
      // behind it.
      note: 'actionableShare は「実装だけで解決した割合」であり、判定の正しさ（precision）ではない。正解ラベルは存在しない。',
    };
  },
  { query: t.Object({ windowDays: t.Optional(t.String()) }) },
);
