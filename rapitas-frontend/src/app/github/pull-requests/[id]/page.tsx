import { Suspense } from 'react';
import PullRequestDetailClient from './PullRequestDetailClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export default function PullRequestDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PullRequestDetailClient />
    </Suspense>
  );
}
