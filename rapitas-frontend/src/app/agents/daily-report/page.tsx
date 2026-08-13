'use client';

/**
 * AgentDailyReportPage
 *
 * /agents/daily-report — daily archive of the autonomous-activity report (one
 * notification per morning, task #564). Thin route shell; the actual UI
 * lives in _components/GrowthClient.
 * NOTE: Moved from /agents/growth — that route is owned by the self-growth
 * ledger dashboard merged via PR #361 (add/add conflict resolution, task #566).
 */

import { requireAuth } from '@/contexts/AuthContext';
import GrowthClient from './_components/GrowthClient';

function AgentDailyReportPage() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <GrowthClient />
    </div>
  );
}

export default requireAuth(AgentDailyReportPage);
