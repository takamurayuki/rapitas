import { useState, useCallback } from "react";
import type { FileDiff, GitHubPRReview, GitHubPRComment } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export type ReviewAction = "approve" | "request_changes" | "comment";

export type InlineComment = {
  path: string;
  line: number;
  body: string;
  side?: "LEFT" | "RIGHT";
};

export type UseCodeReviewReturn = {
  loading: boolean;
  error: string | null;
  // Diff operations
  getDiff: (prId: number) => Promise<FileDiff[]>;
  // Review operations
  getReviews: (prId: number) => Promise<GitHubPRReview[]>;
  submitReview: (prId: number, action: ReviewAction, body?: string) => Promise<void>;
  // Comment operations
  getComments: (prId: number) => Promise<GitHubPRComment[]>;
  addComment: (prId: number, body: string) => Promise<void>;
  addInlineComment: (prId: number, comment: InlineComment) => Promise<void>;
  // Utility
  parseDiffHunks: (patch: string) => DiffHunk[];
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffLine = {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export function useCodeReview(): UseCodeReviewReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <T>(
    url: string,
    options?: RequestInit
  ): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}${url}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getDiff = useCallback((prId: number) => {
    return request<FileDiff[]>(`/github/pull-requests/${prId}/diff`);
  }, [request]);

  const getReviews = useCallback(async (prId: number) => {
    const pr = await request<any>(`/github/pull-requests/${prId}`);
    return pr.reviews || [];
  }, [request]);

  const submitReview = useCallback(
    async (prId: number, action: ReviewAction, body?: string) => {
      const endpoint = action === "approve" ? "approve" : "request-changes";
      if (action === "comment") {
        // コメントのみの場合は別エンドポイント
        await request(`/github/pull-requests/${prId}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
      } else {
        await request(`/github/pull-requests/${prId}/${endpoint}`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
      }
    },
    [request]
  );

  const getComments = useCallback(async (prId: number) => {
    const pr = await request<any>(`/github/pull-requests/${prId}`);
    return pr.comments || [];
  }, [request]);

  const addComment = useCallback(
    async (prId: number, body: string) => {
      await request(`/github/pull-requests/${prId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },
    [request]
  );

  const addInlineComment = useCallback(
    async (prId: number, comment: InlineComment) => {
      await request(`/github/pull-requests/${prId}/comments`, {
        method: "POST",
        body: JSON.stringify(comment),
      });
    },
    [request]
  );

  const parseDiffHunks = useCallback((patch: string): DiffHunk[] => {
    const hunks: DiffHunk[] = [];
    const lines = patch.split("\n");

    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      // ハンクヘッダー（@@ -1,5 +1,6 @@）
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[3], 10);
        currentHunk = {
          header: line,
          oldStart: oldLine,
          oldCount: parseInt(hunkMatch[2] || "1", 10),
          newStart: newLine,
          newCount: parseInt(hunkMatch[4] || "1", 10),
          lines: [
            {
              type: "header",
              content: line,
            },
          ],
        };
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.lines.push({
          type: "add",
          content: line.substring(1),
          newLineNumber: newLine++,
        });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.lines.push({
          type: "remove",
          content: line.substring(1),
          oldLineNumber: oldLine++,
        });
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({
          type: "context",
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        });
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }, []);

  return {
    loading,
    error,
    getDiff,
    getReviews,
    submitReview,
    getComments,
    addComment,
    addInlineComment,
    parseDiffHunks,
  };
}
