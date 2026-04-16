'use client';
// DragOverlay

interface DragOverlayProps {
  /** CSS cursor value applied during the interaction / インタラクション中のCSSカーソル値 */
  cursor: string;
}

/**
 * Renders a fixed full-screen overlay that intercepts mouse events.
 *
 * @param cursor - CSS cursor style to apply / 適用するCSSカーソルスタイル
 */
export default function DragOverlay({ cursor }: DragOverlayProps) {
  return (
    <div
      className="fixed inset-0"
      style={{
        zIndex: 99999,
        cursor,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    />
  );
}
