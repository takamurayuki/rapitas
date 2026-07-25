'use client';
/**
 * AppContent
 *
 * Wraps page content and shifts it right when the side nav is pinned, so the
 * fixed nav panel no longer overlaps the content. Only offsets on large screens
 * (≥lg); on small screens the pinned nav stays an overlay. No effect when
 * unpinned, so default layout is unchanged.
 *
 * Also reserves space for the integrated terminal (Ctrl+J) when it's docked
 * in split mode (left or right), so that fixed-position panel is genuinely
 * side-by-side with the page rather than covering it. Uses padding (not
 * margin) so it composes with the nav's margin-based offset above without
 * either one fighting the other for the same CSS property.
 */
import { useNavStore } from '@/stores/nav-store';
import { useTerminalStore } from '@/feature/terminal/terminal-store';

/**
 * @param children - Page content to render / 描画するページコンテンツ
 */
export default function AppContent({ children }: { children: React.ReactNode }) {
  const isMenuPinned = useNavStore((state) => state.isMenuPinned);
  const terminalIsOpen = useTerminalStore((s) => s.isOpen);
  const terminalDisplayMode = useTerminalStore((s) => s.displayMode);
  const terminalDockSide = useTerminalStore((s) => s.dockSide);
  const terminalSplitWidthPercent = useTerminalStore((s) => s.splitWidthPercent);
  const terminalHasTabs = useTerminalStore((s) => s.tabs.length > 0);
  const isTerminalSplitOpen = terminalDisplayMode === 'split' && terminalIsOpen && terminalHasTabs;

  return (
    <div
      className="transition-[padding] duration-200 ease-out"
      style={{
        paddingRight:
          isTerminalSplitOpen && terminalDockSide === 'right'
            ? `${terminalSplitWidthPercent}vw`
            : undefined,
        paddingLeft:
          isTerminalSplitOpen && terminalDockSide === 'left'
            ? `${terminalSplitWidthPercent}vw`
            : undefined,
      }}
    >
      {/* ml-72 matches the nav width (w-72). Animate to match the panel transition. */}
      <div className={`transition-[margin] duration-300 ${isMenuPinned ? 'lg:ml-72' : ''}`}>
        {children}
      </div>
    </div>
  );
}
