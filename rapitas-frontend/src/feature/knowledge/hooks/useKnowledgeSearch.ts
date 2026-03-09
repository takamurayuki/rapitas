"use client";

import { useState, useCallback } from "react";
import { API_BASE_URL } from "@/utils/api";
import type { KnowledgeSearchResult } from "../types";

export function useKnowledgeSearch() {
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (
      query: string,
      options?: {
        limit?: number;
        minSimilarity?: number;
        category?: string;
        themeId?: number;
      },
    ) => {
      if (!query.trim()) {
        setResults([]);
        return [];
      }

      setIsSearching(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: query });
        if (options?.limit) params.set("limit", String(options.limit));
        if (options?.minSimilarity) params.set("minSimilarity", String(options.minSimilarity));
        if (options?.category) params.set("category", options.category);
        if (options?.themeId) params.set("themeId", String(options.themeId));

        const res = await fetch(`${API_BASE_URL}/knowledge/search?${params}`);
        if (!res.ok) throw new Error("Search failed");
        const json = await res.json();
        setResults(json.results);
        return json.results as KnowledgeSearchResult[];
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      } finally {
        setIsSearching(false);
      }
    },
    [],
  );

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return { results, isSearching, error, search, clearResults };
}
