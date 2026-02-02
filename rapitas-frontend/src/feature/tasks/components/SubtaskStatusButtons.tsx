"use client";
import TaskStatusChange from "./TaskStatusChange";
import { statusConfig, renderStatusIcon } from "../config/StatusConfig";
import { API_BASE_URL } from "@/utils/api";
import type { Status } from "@/types";

// ステータスの配列を共通で定義
export const STATUS_OPTIONS: Status[] = ["todo", "in-progress", "done"];

interface SubtaskStatusButtonsProps {
  taskId: number;
  currentStatus: string;
  onTaskUpdated?: () => void;
  size?: "sm" | "md";
}

export default function SubtaskStatusButtons({
  taskId,
  currentStatus,
  onTaskUpdated,
  size = "sm",
}: SubtaskStatusButtonsProps) {
  const handleStatusChange = async (newStatus: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok && onTaskUpdated) {
        onTaskUpdated();
      }
    } catch (error) {
      console.error("Failed to update subtask status:", error);
    }
  };

  return (
    <StatusButtonGroup
      currentStatus={currentStatus}
      onStatusChange={handleStatusChange}
      size={size}
    />
  );
}

/**
 * ステータスボタングループ - タスクのステータス変更用の共通コンポーネント
 */
interface StatusButtonGroupProps {
  currentStatus: string;
  onStatusChange: (newStatus: string) => void;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function StatusButtonGroup({
  currentStatus,
  onStatusChange,
  size = "md",
  showLabel = false,
  className = "",
}: StatusButtonGroupProps) {
  const gapClass = showLabel ? "gap-2" : "gap-1";

  return (
    <div className={`flex items-center ${gapClass} shrink-0 ${className}`}>
      {STATUS_OPTIONS.map((status) => {
        const config = statusConfig[status];
        return (
          <TaskStatusChange
            key={status}
            status={status}
            currentStatus={currentStatus}
            config={config}
            renderIcon={renderStatusIcon}
            onClick={onStatusChange}
            size={size}
            showLabel={showLabel}
          />
        );
      })}
    </div>
  );
}
