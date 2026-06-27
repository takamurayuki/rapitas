'use client';
/**
 * AppContent
 *
 * Wraps page content and shifts it right when the side nav is pinned, so the
 * fixed nav panel no longer overlaps the content. Only offsets on large screens
 * (≥lg); on small screens the pinned nav stays an overlay. No effect when
 * unpinned, so default layout is unchanged.
 */
import { useNavStore } from '@/stores/nav-store';
import { Breadcrumbs } from '@/components/common/Breadcrumbs';

/**
 * @param children - Page content to render / 描画するページコンテンツ
 */
export default function AppContent({ children }: { children: React.ReactNode }) {
  const isMenuPinned = useNavStore((state) => state.isMenuPinned);
  // ml-72 matches the nav width (w-72). Animate to match the panel transition.
  return (
    <div className={`transition-[margin] duration-300 ${isMenuPinned ? 'lg:ml-72' : ''}`}>
      <Breadcrumbs />
      {children}
    </div>
  );
}
