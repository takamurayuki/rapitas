'use client';
/**
 * /goals — the goal list.
 */
import { Suspense } from 'react';
import GoalsClient from './_components/GoalsClient';

export default function GoalsPage() {
  return (
    <Suspense fallback={null}>
      <GoalsClient />
    </Suspense>
  );
}
