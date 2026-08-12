'use client';

/**
 * AgentGrowthPage
 *
 * /agents/growth — daily archive of the autonomous-activity report (one
 * notification per morning, task #564). Thin route shell; the actual UI
 * lives in _components/GrowthClient.
 */

import { requireAuth } from '@/contexts/AuthContext';
import GrowthClient from './_components/GrowthClient';

function AgentGrowthPage() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <GrowthClient />
    </div>
  );
}

export default requireAuth(AgentGrowthPage);
