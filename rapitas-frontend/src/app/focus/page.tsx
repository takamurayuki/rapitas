import { Suspense } from 'react';
import FocusClient from './FocusClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function FocusPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <FocusClient />
    </Suspense>
  );
}
