/**
 * Realtime Service テスト
 * SSEリアルタイム通信サービスのテスト
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { RealtimeService } = await import("../services/realtime-service");

describe("RealtimeService", () => {
  let service: InstanceType<typeof RealtimeService>;

  beforeEach(() => {
    // Use getInstance since it's a singleton - we'll work with shutdown/cleanup
    service = RealtimeService.getInstance();
    service.shutdown();
  });

  function createMockResponse() {
    return {
      write: mock(() => {}),
      flush: mock(() => {}),
    };
  }

  describe("registerClient / removeClient", () => {
    test("クライアントを登録できること", () => {
      const response = createMockResponse();
      const clientId = service.registerClient(response, ["agent_execution"]);
      expect(clientId).toBeTruthy();
      expect(service.getClientCount()).toBe(1);
    });

    test("クライアントを削除できること", () => {
      const response = createMockResponse();
      const clientId = service.registerClient(response);
      service.removeClient(clientId);
      expect(service.getClientCount()).toBe(0);
    });

    test("接続成功メッセージが送信されること", () => {
      const response = createMockResponse();
      service.registerClient(response, ["test"]);
      expect(response.write).toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    test("購読クライアントにイベントを送信すること", () => {
      const response = createMockResponse();
      service.registerClient(response, ["agent_execution"]);

      service.broadcast("agent_execution", "test_event", { data: "hello" });
      // write called: once for connected, once for broadcast
      expect(response.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test("非購読クライアントにはイベントを送信しないこと", () => {
      const response = createMockResponse();
      service.registerClient(response, ["github_events"]);

      const writeCount = response.write.mock.calls.length;
      service.broadcast("agent_execution", "test_event", { data: "hello" });
      expect(response.write.mock.calls.length).toBe(writeCount); // no new calls
    });

    test("ワイルドカード購読はすべてのイベントを受信すること", () => {
      const response = createMockResponse();
      service.registerClient(response, ["*"]);

      service.broadcast("agent_execution", "test", { data: "hello" });
      expect(response.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("broadcastAll", () => {
    test("全クライアントにイベントを送信すること", () => {
      const response1 = createMockResponse();
      const response2 = createMockResponse();
      service.registerClient(response1, ["a"]);
      service.registerClient(response2, ["b"]);

      service.broadcastAll("shutdown", { reason: "test" });
      // Each got connected + broadcastAll
      expect(response1.write.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(response2.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sendExecutionOutput", () => {
    test("実行チャンネルに出力を送信すること", () => {
      const response = createMockResponse();
      service.registerClient(response, ["execution:1"]);

      service.sendExecutionOutput(1, "Hello output", false);
      expect(response.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sendExecutionStatusUpdate", () => {
    test("実行チャンネルとagent_executionの両方に送信すること", () => {
      const response1 = createMockResponse();
      const response2 = createMockResponse();
      service.registerClient(response1, ["execution:1"]);
      service.registerClient(response2, ["agent_execution"]);

      service.sendExecutionStatusUpdate(1, "completed");
      expect(response1.write.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(response2.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sendGitHubEvent", () => {
    test("github_eventsチャンネルに送信すること", () => {
      const response = createMockResponse();
      service.registerClient(response, ["github_events"]);
      service.sendGitHubEvent("push", { repo: "test" });
      expect(response.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sendNotification", () => {
    test("notificationsチャンネルに送信すること", () => {
      const response = createMockResponse();
      service.registerClient(response, ["notifications"]);
      service.sendNotification({ id: 1, type: "info", title: "Test", message: "Hello" });
      expect(response.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("sendTaskUpdate", () => {
    test("タスクチャンネルとtask_updatesの両方に送信すること", () => {
      const response1 = createMockResponse();
      const response2 = createMockResponse();
      service.registerClient(response1, ["task:1"]);
      service.registerClient(response2, ["task_updates"]);

      service.sendTaskUpdate(1, "updated", { title: "Test" });
      expect(response1.write.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(response2.write.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getChannelHistory", () => {
    test("チャンネル履歴を取得できること", () => {
      service.broadcast("test_channel", "event1", { data: 1 });
      service.broadcast("test_channel", "event2", { data: 2 });

      const history = service.getChannelHistory("test_channel");
      expect(history.length).toBe(2);
    });

    test("存在しないチャンネルは空配列を返すこと", () => {
      const history = service.getChannelHistory("nonexistent");
      expect(history).toEqual([]);
    });

    test("since指定で時間フィルタできること", () => {
      service.broadcast("test_channel", "old", { data: 1 });
      const sinceDate = new Date();
      service.broadcast("test_channel", "new", { data: 2 });

      const history = service.getChannelHistory("test_channel", sinceDate);
      expect(history.length).toBeLessThanOrEqual(1);
    });
  });

  describe("subscription management", () => {
    test("購読を更新できること", () => {
      const response = createMockResponse();
      const clientId = service.registerClient(response, ["a"]);
      service.updateSubscriptions(clientId, ["b", "c"]);

      // Now should not receive "a" events
      const writeCount = response.write.mock.calls.length;
      service.broadcast("a", "test", {});
      expect(response.write.mock.calls.length).toBe(writeCount);

      // Should receive "b" events
      service.broadcast("b", "test", {});
      expect(response.write.mock.calls.length).toBeGreaterThan(writeCount);
    });

    test("購読を追加できること", () => {
      const response = createMockResponse();
      const clientId = service.registerClient(response, []);
      service.addSubscription(clientId, "new_channel");

      const writeCount = response.write.mock.calls.length;
      service.broadcast("new_channel", "test", {});
      expect(response.write.mock.calls.length).toBeGreaterThan(writeCount);
    });

    test("購読を削除できること", () => {
      const response = createMockResponse();
      const clientId = service.registerClient(response, ["channel"]);
      service.removeSubscription(clientId, "channel");

      const writeCount = response.write.mock.calls.length;
      service.broadcast("channel", "test", {});
      expect(response.write.mock.calls.length).toBe(writeCount);
    });
  });

  describe("getClients", () => {
    test("接続中のクライアント情報を返すこと", () => {
      const response = createMockResponse();
      service.registerClient(response, ["test"]);
      const clients = service.getClients();
      expect(clients.length).toBe(1);
      expect(clients[0].subscriptions).toContain("test");
    });
  });

  describe("shutdown", () => {
    test("シャットダウンで全クライアントをクリアすること", () => {
      const response = createMockResponse();
      service.registerClient(response, []);
      service.shutdown();
      expect(service.getClientCount()).toBe(0);
    });
  });
});
