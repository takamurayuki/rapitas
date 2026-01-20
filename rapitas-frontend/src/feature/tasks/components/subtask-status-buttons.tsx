"use client";
import TaskStatusChange from "./task-status-change";
import { statusConfig, renderStatusIcon } from "../config/status-config";

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
      const response = await fetch(`http://localhost:3001/tasks/${taskId}`, {
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
    <div className="flex items-center gap-1 shrink-0">
      {["todo", "in-progress", "done"].map((status) => {
        const config = statusConfig[status as keyof typeof statusConfig];
        return (
          <TaskStatusChange
            key={status}
            status={status}
            currentStatus={currentStatus}
            config={config}
            renderIcon={renderStatusIcon}
            onClick={handleStatusChange}
            size={size}
          />
        );
      })}
    </div>
  );
}
