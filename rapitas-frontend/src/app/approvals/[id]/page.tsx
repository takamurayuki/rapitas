import { Suspense } from 'react';
import ApprovalDetailClient from './ApprovalDetailClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export default function ApprovalDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner variant="compact" />}>
      <ApprovalDetailClient />
    </Suspense>
  );
}
