'use client';
import { Suspense } from 'react';
import BacklogSettingsClient from './_components/BacklogSettingsClient';

export default function BacklogSettingsPage() {
  return (
    <Suspense fallback={null}>
      <BacklogSettingsClient />
    </Suspense>
  );
}
