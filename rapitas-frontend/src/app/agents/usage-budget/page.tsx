'use client';
// UsageBudgetPage — AI usage budget planning (daily × theme usage, advisory monthly budget)

import { requireAuth } from '@/contexts/AuthContext';
import { UsageBudgetClient } from './_components/UsageBudgetClient';

function UsageBudgetPage() {
  return <UsageBudgetClient />;
}

export default requireAuth(UsageBudgetPage);
