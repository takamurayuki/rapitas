/**
 * Pomodoro API Routes
 * ポモドーロタイマー管理エンドポイント
 */
import { Elysia, t } from "elysia";
import {
  getActiveSession,
  startPomodoro,
  pausePomodoro,
  resumePomodoro,
  completePomodoro,
  cancelPomodoro,
  getStatistics,
  getHistory,
} from "../../services/pomodoro-service";
import { createLogger } from "../../config/logger";

const log = createLogger("routes:pomodoro");

export const pomodoroRoutes = new Elysia({ prefix: "/pomodoro" })
  // アクティブセッション取得
  .get("/active", async ({ set }) => {
    try {
      const session = await getActiveSession();
      return { success: true, session };
    } catch (error) {
      log.error({ err: error }, "Get active pomodoro error");
      set.status = 500;
      return { success: false, error: "アクティブセッションの取得に失敗しました" };
    }
  })

  // ポモドーロ開始
  .post(
    "/start",
    async ({ body, set }) => {
      try {
        const b = body as {
          taskId?: number;
          duration?: number;
          type?: "work" | "short_break" | "long_break";
          completedPomodoros?: number;
        };
        const session = await startPomodoro({
          taskId: b.taskId,
          duration: b.duration,
          type: b.type,
          completedPomodoros: b.completedPomodoros,
        });
        return { success: true, session };
      } catch (error) {
        log.error({ err: error }, "Start pomodoro error");
        set.status = 500;
        return { success: false, error: "ポモドーロの開始に失敗しました" };
      }
    },
    {
      body: t.Object({
        taskId: t.Optional(t.Number()),
        duration: t.Optional(t.Number({ minimum: 60, maximum: 7200 })),
        type: t.Optional(t.Union([
          t.Literal("work"),
          t.Literal("short_break"),
          t.Literal("long_break"),
        ])),
        completedPomodoros: t.Optional(t.Number({ minimum: 0 })),
      }),
    }
  )

  // ポモドーロ一時停止
  .post("/sessions/:id/pause", async ({ params, set }) => {
    try {
      const sessionId = parseInt(params.id);
      if (isNaN(sessionId)) {
        set.status = 400;
        return { success: false, error: "無効なセッションIDです" };
      }
      const session = await pausePomodoro(sessionId);
      return { success: true, session };
    } catch (error) {
      log.error({ err: error }, "Pause pomodoro error");
      set.status = 400;
      return {
        success: false,
        error: error instanceof Error ? error.message : "一時停止に失敗しました",
      };
    }
  })

  // ポモドーロ再開
  .post("/sessions/:id/resume", async ({ params, set }) => {
    try {
      const sessionId = parseInt(params.id);
      if (isNaN(sessionId)) {
        set.status = 400;
        return { success: false, error: "無効なセッションIDです" };
      }
      const session = await resumePomodoro(sessionId);
      return { success: true, session };
    } catch (error) {
      log.error({ err: error }, "Resume pomodoro error");
      set.status = 400;
      return {
        success: false,
        error: error instanceof Error ? error.message : "再開に失敗しました",
      };
    }
  })

  // ポモドーロ完了
  .post("/sessions/:id/complete", async ({ params, set }) => {
    try {
      const sessionId = parseInt(params.id);
      if (isNaN(sessionId)) {
        set.status = 400;
        return { success: false, error: "無効なセッションIDです" };
      }
      const result = await completePomodoro(sessionId);
      return { success: true, ...result };
    } catch (error) {
      log.error({ err: error }, "Complete pomodoro error");
      set.status = 400;
      return {
        success: false,
        error: error instanceof Error ? error.message : "完了処理に失敗しました",
      };
    }
  })

  // ポモドーロキャンセル
  .post("/sessions/:id/cancel", async ({ params, set }) => {
    try {
      const sessionId = parseInt(params.id);
      if (isNaN(sessionId)) {
        set.status = 400;
        return { success: false, error: "無効なセッションIDです" };
      }
      const session = await cancelPomodoro(sessionId);
      return { success: true, session };
    } catch (error) {
      log.error({ err: error }, "Cancel pomodoro error");
      set.status = 400;
      return {
        success: false,
        error: error instanceof Error ? error.message : "キャンセルに失敗しました",
      };
    }
  })

  // 統計情報取得
  .get("/statistics", async ({ query, set }) => {
    try {
      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;
      const taskId = query.taskId ? parseInt(query.taskId) : undefined;

      const stats = await getStatistics({ startDate, endDate, taskId });
      return { success: true, ...stats };
    } catch (error) {
      log.error({ err: error }, "Get pomodoro statistics error");
      set.status = 500;
      return { success: false, error: "統計情報の取得に失敗しました" };
    }
  })

  // セッション履歴取得
  .get("/history", async ({ query, set }) => {
    try {
      const limit = query.limit ? parseInt(query.limit) : 20;
      const offset = query.offset ? parseInt(query.offset) : 0;

      const result = await getHistory({ limit, offset });
      return { success: true, ...result };
    } catch (error) {
      log.error({ err: error }, "Get pomodoro history error");
      set.status = 500;
      return { success: false, error: "履歴の取得に失敗しました" };
    }
  });
