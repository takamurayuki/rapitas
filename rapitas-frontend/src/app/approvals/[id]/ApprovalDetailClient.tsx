'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function ApprovalDetailClient() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  useEffect(() => {
    // Redirect to /approvals page and expand the target ID via query param
    router.replace(`/approvals?expand=${id}`);
  }, [router, id]);

  return <LoadingSpinner variant="compact" />;
}
