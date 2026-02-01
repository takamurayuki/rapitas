"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import FloatingAIMenu from "./FloatingAIMenu";

/**
 * FloatingAIMenuのラッパーコンポーネント
 * 特定のページ（タスク詳細ページなど）では非表示にする
 */
export default function FloatingAIMenuWrapper() {
  const pathname = usePathname();
  const [windowPathname, setWindowPathname] = useState<string | null>(null);

  // TauriのiframeではusePathname()が正しく動作しない場合があるため、
  // window.locationからパスを直接取得するフォールバックを追加
  useEffect(() => {
    if (typeof window !== "undefined") {
      setWindowPathname(window.location.pathname);
    }
  }, []);

  // タスク詳細ページ（/tasks/[id]）では非表示にする
  // AIAnalysisPanelとの重複を避けるため
  const currentPath = pathname || windowPathname || "";
  const isTaskDetailPage = /^\/tasks\/\d+$/.test(currentPath);

  if (isTaskDetailPage) {
    return null;
  }

  return <FloatingAIMenu />;
}
