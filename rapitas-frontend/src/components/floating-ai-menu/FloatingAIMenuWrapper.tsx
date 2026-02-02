"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import FloatingAIMenu from "./FloatingAIMenu";
import { useTaskDetailVisibilityStore } from "@/stores/taskDetailVisibilityStore";
import { isTauri } from "@/utils/tauri";

/**
 * FloatingAIMenuのラッパーコンポーネント
 * タスク詳細ページおよびタスク詳細パネル表示時は非表示にする
 */
export default function FloatingAIMenuWrapper() {
  const pathname = usePathname();
  const [windowPathname, setWindowPathname] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const isTaskDetailVisible = useTaskDetailVisibilityStore(
    (state) => state.isTaskDetailVisible
  );

  // Tauri環境の検出とパス取得
  useEffect(() => {
    if (typeof window !== "undefined") {
      setWindowPathname(window.location.pathname);
      setIsTauriEnv(isTauri());
    }
  }, []);

  // タスク詳細ページでは非表示にする
  // Web環境: /tasks/[id] 形式
  // Tauri環境: /tasks/detail?id=[id] または /task-detail?id=[id] 形式
  const currentPath = pathname || windowPathname || "";
  const isTaskDetailPage = isTauriEnv
    ? currentPath.startsWith("/tasks/detail") ||
      currentPath.startsWith("/task-detail")
    : /^\/tasks\/\d+$/.test(currentPath);

  // タスク詳細ページまたはタスク詳細パネルが表示されている場合は非表示
  if (isTaskDetailPage || isTaskDetailVisible) {
    return null;
  }

  return <FloatingAIMenu />;
}
