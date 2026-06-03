'use client';
import { Suspense } from 'react';
import DecisionsClient from './_components/DecisionsClient';

export default function DecisionsPage() {
  return (
    <Suspense fallback={null}>
      <DecisionsClient />
    </Suspense>
  );
}
