/**
 * Panel Health Route
 *
 * Read-only view of how many models actually judged each adversarial diff
 * review. Not responsible for the verdict — see
 * services/agents/verification/panel-health for why this deliberately
 * decides nothing.
 *
 * Reads the `panel` block S1 added to the `adversarial_review` timeline
 * event. Events recorded before S1 carry no `panel`, so their judged count
 * is derived from the juror rows instead; `plannedKnown` says which is
 * which, because a derived planned count would be a guess (a rested juror
 * leaves no row at all).
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import {
  DEFAULT_MIN_JUDGED,
  summarisePanelHealth,
  type PanelHealthRow,
} from '../../../services/agents/verification/panel-health';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 60;

/** The shape the review event's payload carries. */
interface ReviewPayload {
  jurors?: { verdict?: string }[];
  panel?: { planned?: number; judged?: number };
}

const panelHealthRoutes = new Elysia().get(
  '/agents/panel-health',
  async ({ query }) => {
    const requested = query.windowDays !== undefined ? Number(query.windowDays) : NaN;
    const windowDays =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_WINDOW_DAYS)
        : DEFAULT_WINDOW_DAYS;
    const minRequested = query.minJudged !== undefined ? Number(query.minJudged) : NaN;
    const minJudged =
      Number.isFinite(minRequested) && minRequested > 0
        ? Math.floor(minRequested)
        : DEFAULT_MIN_JUDGED;

    const events = await prisma.timelineEvent.findMany({
      where: {
        eventType: 'adversarial_review',
        createdAt: { gte: new Date(Date.now() - windowDays * DAY_MS) },
      },
      select: { payload: true, createdAt: true },
    });

    const rows: PanelHealthRow[] = [];
    let plannedKnown = 0;
    for (const e of events) {
      let p: ReviewPayload;
      try {
        p = JSON.parse(e.payload) as ReviewPayload;
      } catch {
        continue;
      }
      const judged =
        p.panel?.judged ??
        (p.jurors ?? []).filter((j) => j.verdict === 'pass' || j.verdict === 'fail').length;
      // Pre-S1 events have no planned count. Treating planned as equal to
      // judged keeps seatsLost honest: it reports only seats we KNOW were
      // built and never asked.
      const planned = p.panel?.planned ?? judged;
      if (p.panel?.planned !== undefined) plannedKnown++;
      rows.push({ judged, planned, at: e.createdAt });
    }

    return {
      windowDays,
      plannedKnown,
      plannedUnknown: rows.length - plannedKnown,
      ...summarisePanelHealth(rows, minJudged),
      note: 'minJudged は表示のための閾値であり、判定には一切影響しない。不足を理由に verdict を捨てると、単独の fail が通過してゲートが弱くなる。',
    };
  },
  { query: t.Object({ windowDays: t.Optional(t.String()), minJudged: t.Optional(t.String()) }) },
);

export default panelHealthRoutes;
