import VocabDeckDetailClient from './VocabDeckDetailClient';

// NOTE: Required for static export — generates placeholder route params at build time.
export async function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export default function VocabDeckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <VocabDeckDetailClient params={params} />;
}
