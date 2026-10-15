'use client';
import { Suspense } from 'react';
import HypothesesClient from './_components/HypothesesClient';

export default function HypothesesPage() {
  return (
    <Suspense fallback={null}>
      <HypothesesClient />
    </Suspense>
  );
}
