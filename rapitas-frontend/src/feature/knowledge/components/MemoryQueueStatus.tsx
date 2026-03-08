"use client";

import { useTranslations } from "next-intl";
import type { QueueStatus } from "../types";

interface MemoryQueueStatusProps {
  status: QueueStatus;
}

export function MemoryQueueStatus({ status }: MemoryQueueStatusProps) {
  const t = useTranslations("knowledge.admin");

  const items = [
    { label: t("pending"), value: status.pending, color: "bg-blue-500" },
    { label: t("processing"), value: status.processing, color: "bg-yellow-500" },
    { label: t("completed"), value: status.completed, color: "bg-green-500" },
    { label: t("failed"), value: status.failed, color: "bg-red-500" },
    { label: t("deadLetter"), value: status.deadLetter, color: "bg-gray-500" },
    { label: t("embeddingCount"), value: status.embeddingCount, color: "bg-indigo-500" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-gray-200 bg-white p-2 text-center dark:border-gray-700 dark:bg-gray-800"
        >
          <div className={`mx-auto mb-1 h-1.5 w-8 rounded-full ${item.color}`} />
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{item.value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
        </div>
      ))}
    </div>
  );
}
