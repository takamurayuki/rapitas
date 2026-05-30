'use client';
import { Suspense } from 'react';
import ConcernsClient from './_components/ConcernsClient';

export default function ConcernsPage() {
  return (
    <Suspense fallback={null}>
      <ConcernsClient />
    </Suspense>
  );
}
