'use client';
import { Suspense } from 'react';
import IdeasClient from './_components/IdeasClient';

export default function IdeasPage() {
  return (
    <Suspense fallback={null}>
      <IdeasClient />
    </Suspense>
  );
}
