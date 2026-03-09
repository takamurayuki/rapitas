"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE_URL } from "@/utils/api";
import type { KnowledgeContradiction, ContradictionResolution } from "../types";

export function useContradictions(limit = 20) {
  const [contradictions, setContradictions] = useState<KnowledgeContradiction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContradictions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/memory/contradictions?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch contradictions");
      const json = await res.json();
      setContradictions(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchContradictions();
  }, [fetchContradictions]);

  const resolve = useCallback(
    async (id: number, resolution: ContradictionResolution) => {
      const res = await fetch(`${API_BASE_URL}/memory/contradictions/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) throw new Error("Failed to resolve contradiction");
      await fetchContradictions();
    },
    [fetchContradictions],
  );

  return { contradictions, isLoading, error, refetch: fetchContradictions, resolve };
}
