"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { KnowledgeContradiction, ContradictionResolution } from "../types";

interface ContradictionResolverProps {
  contradiction: KnowledgeContradiction;
  onResolve: (id: number, resolution: ContradictionResolution) => Promise<void>;
}

export function ContradictionResolver({ contradiction, onResolve }: ContradictionResolverProps) {
  const t = useTranslations("knowledge.contradictions");
  const [isResolving, setIsResolving] = useState(false);

  const handleResolve = async (resolution: ContradictionResolution) => {
    setIsResolving(true);
    try {
      await onResolve(contradiction.id, resolution);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-200">
          {t(`types.${contradiction.contradictionType}`)}
        </span>
        {contradiction.description && (
          <span className="text-xs text-gray-600 dark:text-gray-400">{contradiction.description}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("entryA")}</h4>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{contradiction.entryA.title}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-3">{contradiction.entryA.content}</p>
          <div className="mt-2 text-xs text-gray-500">
            Confidence: {Math.round(contradiction.entryA.confidence * 100)}%
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("entryB")}</h4>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{contradiction.entryB.title}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-3">{contradiction.entryB.content}</p>
          <div className="mt-2 text-xs text-gray-500">
            Confidence: {Math.round(contradiction.entryB.confidence * 100)}%
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => handleResolve("keep_a")}
          disabled={isResolving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t("keepA")}
        </button>
        <button
          onClick={() => handleResolve("keep_b")}
          disabled={isResolving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t("keepB")}
        </button>
        <button
          onClick={() => handleResolve("merge")}
          disabled={isResolving}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {t("merge")}
        </button>
        <button
          onClick={() => handleResolve("dismiss")}
          disabled={isResolving}
          className="rounded-lg bg-gray-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-600 disabled:opacity-50"
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
