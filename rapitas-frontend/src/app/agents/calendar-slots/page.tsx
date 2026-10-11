'use client';

/**
 * AgentCalendarSlotsPage
 *
 * /agents/calendar-slots — dashboard for the calendar-aware auto-run gate
 * (task 1174): next run schedule, execution log, and calendar sync state.
 * Thin route shell; the UI lives in _components/CalendarSlotsClient.
 */

import { requireAuth } from '@/contexts/AuthContext';
import CalendarSlotsClient from './_components/CalendarSlotsClient';

function AgentCalendarSlotsPage() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <CalendarSlotsClient />
    </div>
  );
}

export default requireAuth(AgentCalendarSlotsPage);
