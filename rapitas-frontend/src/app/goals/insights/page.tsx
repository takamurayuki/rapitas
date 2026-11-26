'use client';
/**
 * /goals/insights — the product-purpose metrics.
 */
import { Suspense } from 'react';
import InsightsClient from './_components/InsightsClient';

export default function GoalInsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsClient />
    </Suspense>
  );
}
