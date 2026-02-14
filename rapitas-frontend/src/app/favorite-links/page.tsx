import { Metadata } from 'next';
import { FavoriteLinksManager } from '@/components/FavoriteLinks';

export const metadata: Metadata = {
  title: 'お気に入りリンク | Rapitas',
  description: 'よくアクセスする外部サイトのリンクを管理',
};

export default function FavoriteLinksPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <FavoriteLinksManager />
    </div>
  );
}