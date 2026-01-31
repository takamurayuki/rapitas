"use client";

import { usePathname } from "next/navigation";
import FloatingAIMenu from "./FloatingAIMenu";

/**
 * FloatingAIMenuのラッパーコンポーネント
 * 特定のページ（タスク詳細ページなど）では非表示にする
 */
export default function FloatingAIMenuWrapper() {
  const pathname = usePathname();

  // タスク詳細ページ（/tasks/[id]）では非表示にする
  // AIAnalysisPanelとの重複を避けるため
  const isTaskDetailPage = /^\/tasks\/\d+$/.test(pathname);

  if (isTaskDetailPage) {
    return null;
  }

  return <FloatingAIMenu />;
}
