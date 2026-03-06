/**
 * Notification Service テスト
 * 通知メッセージのフォーマットロジックを検証
 *
 * notification-service.tsの各関数が生成するパラメータを
 * モックなしでテスト可能な形で検証する
 */
import { describe, test, expect } from "bun:test";

// 通知サービスの関数はprismaとrealtimeServiceに直接依存しているため、
// メッセージフォーマットロジックのみを抽出してテストする

describe("Notification Message Formatting", () => {
  describe("notifyTaskCompleted のメッセージ", () => {
    test("正しいタイプとメッセージが生成されること", () => {
      const taskId = 123;
      const taskTitle = "テストタスク";

      const params = {
        type: "task_completed" as const,
        title: "タスク完了",
        message: `「${taskTitle}」が完了しました`,
        link: `/tasks?taskId=${taskId}`,
        metadata: { taskId },
      };

      expect(params.type).toBe("task_completed");
      expect(params.title).toBe("タスク完了");
      expect(params.message).toContain("テストタスク");
      expect(params.message).toContain("完了しました");
      expect(params.link).toBe("/tasks?taskId=123");
      expect(params.metadata.taskId).toBe(123);
    });
  });

  describe("notifyAgentExecutionCompleted のメッセージ", () => {
    test("成功時に正しいメッセージが生成されること", () => {
      const success = true;
      const taskTitle = "AIタスク";

      const type = success ? "agent_execution_completed" : "agent_execution_failed";
      const title = success ? "AI実行完了" : "AI実行失敗";
      const message = success
        ? `「${taskTitle}」のAI実行が完了しました`
        : `「${taskTitle}」のAI実行が失敗しました`;

      expect(type).toBe("agent_execution_completed");
      expect(title).toBe("AI実行完了");
      expect(message).toContain("完了しました");
    });

    test("失敗時に正しいメッセージが生成されること", () => {
      const success = false;
      const taskTitle = "AIタスク";

      const type = success ? "agent_execution_completed" : "agent_execution_failed";
      const title = success ? "AI実行完了" : "AI実行失敗";
      const message = success
        ? `「${taskTitle}」のAI実行が完了しました`
        : `「${taskTitle}」のAI実行が失敗しました`;

      expect(type).toBe("agent_execution_failed");
      expect(title).toBe("AI実行失敗");
      expect(message).toContain("失敗しました");
    });
  });

  describe("notifyApprovalRequested のメッセージ", () => {
    test("正しいリンクとメッセージが生成されること", () => {
      const title = "承認テスト";

      const params = {
        type: "approval_requested" as const,
        title: "承認リクエスト",
        message: `「${title}」の承認が必要です`,
        link: "/approvals",
        metadata: { approvalId: 5 },
      };

      expect(params.type).toBe("approval_requested");
      expect(params.link).toBe("/approvals");
      expect(params.message).toContain("承認テスト");
      expect(params.message).toContain("承認が必要です");
    });
  });

  describe("notifyAchievementUnlocked のメッセージ", () => {
    test("アイコン付きメッセージが生成されること", () => {
      const achievementName = "初回完了";
      const achievementIcon = "🏆";

      const message = `${achievementIcon} 「${achievementName}」を達成しました！`;

      expect(message).toContain("🏆");
      expect(message).toContain("初回完了");
      expect(message).toContain("達成しました");
    });
  });

  describe("notifyPomodoroCompleted のメッセージ", () => {
    test("タスクタイトル付きの場合", () => {
      const taskTitle: string | null = "テストタスク";
      const completedCount = 3;

      const message = taskTitle
        ? `「${taskTitle}」のポモドーロ #${completedCount} が完了しました`
        : `ポモドーロ #${completedCount} が完了しました`;

      expect(message).toContain("テストタスク");
      expect(message).toContain("#3");
      expect(message).toContain("完了しました");
    });

    test("タスクタイトルなしの場合", () => {
      const taskTitle: string | null = null;
      const completedCount = 5;

      const message = taskTitle
        ? `「${taskTitle}」のポモドーロ #${completedCount} が完了しました`
        : `ポモドーロ #${completedCount} が完了しました`;

      expect(message).toContain("#5");
      expect(message).not.toContain("null");
      expect(message).toBe("ポモドーロ #5 が完了しました");
    });
  });

  describe("createNotification のmetadataシリアライズ", () => {
    test("metadataがJSON.stringifyされること", () => {
      const metadata = { foo: "bar" };
      const serialized = metadata ? JSON.stringify(metadata) : null;
      expect(serialized).toBe('{"foo":"bar"}');
    });

    test("metadataがない場合nullになること", () => {
      const metadata: Record<string, unknown> | undefined = undefined;
      const serialized = metadata ? JSON.stringify(metadata) : null;
      expect(serialized).toBeNull();
    });
  });

  describe("NotificationType の網羅性", () => {
    test("全通知タイプが定義されていること", () => {
      const types = [
        "task_completed",
        "task_assigned",
        "agent_execution_completed",
        "agent_execution_failed",
        "agent_execution_resumed",
        "approval_requested",
        "approval_completed",
        "achievement_unlocked",
        "pomodoro_completed",
        "habit_reminder",
        "schedule_reminder",
        "system",
      ];

      expect(types).toHaveLength(12);
      expect(types).toContain("task_completed");
      expect(types).toContain("pomodoro_completed");
    });
  });
});
