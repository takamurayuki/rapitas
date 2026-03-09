/**
 * Smart Action API Route
 * Intent classification via regex + keyword matching for command bar
 */
import { Elysia, t } from "elysia";

type Intent = "create_task" | "start_learning" | "navigate" | "search";

interface SmartActionResult {
  intent: Intent;
  action: {
    route: string;
    prefill?: string;
    query?: string;
  };
}

// Navigation targets
const NAVIGATION_MAP: Record<string, string> = {
  "ダッシュボード": "/dashboard",
  "dashboard": "/dashboard",
  "ホーム": "/",
  "home": "/",
  "カンバン": "/kanban",
  "kanban": "/kanban",
  "カレンダー": "/calendar",
  "calendar": "/calendar",
  "フラッシュカード": "/flashcards",
  "flashcard": "/flashcards",
  "flashcards": "/flashcards",
  "レポート": "/reports",
  "report": "/reports",
  "reports": "/reports",
  "設定": "/settings",
  "settings": "/settings",
  "学習": "/learning-goals",
  "learning": "/learning-goals",
  "承認": "/approvals",
  "approval": "/approvals",
  "approvals": "/approvals",
};

function classifyIntent(text: string): SmartActionResult {
  const normalized = text.toLowerCase().trim();

  // Navigate intent: exact match on known pages or "open" pattern
  const openPatterns = /^(開く|open|go to|goto|移動|表示)\s*/i;
  const cleanedForNav = normalized.replace(openPatterns, "").trim();

  for (const [keyword, route] of Object.entries(NAVIGATION_MAP)) {
    if (cleanedForNav === keyword.toLowerCase() || normalized === keyword.toLowerCase()) {
      return {
        intent: "navigate",
        action: { route },
      };
    }
  }

  // Create task intent
  const createTaskPatterns = /作って|作成|追加|タスク|todo|create|add|make|build|implement|実装|開発|修正|fix|bug/i;
  if (createTaskPatterns.test(normalized)) {
    return {
      intent: "create_task",
      action: {
        route: "/tasks/new",
        prefill: text,
      },
    };
  }

  // Start learning intent
  const learningPatterns = /学習|勉強|習得|learn|study|master|理解|understand|tutorial|入門/i;
  if (learningPatterns.test(normalized)) {
    return {
      intent: "start_learning",
      action: {
        route: "/learning-goals",
        prefill: text,
      },
    };
  }

  // Default: search
  return {
    intent: "search",
    action: {
      route: "/",
      query: text,
    },
  };
}

export const smartActionRoutes = new Elysia({ prefix: "/smart-action" })
  .post(
    "/",
    async ({ body }) => {
      const { text } = body;
      return classifyIntent(text);
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1 }),
      }),
    }
  );
