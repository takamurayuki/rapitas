/**
 * Agent Audit Log テスト
 * 監査ログユーティリティのテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockPrisma = {
  agentConfigAuditLog: {
    create: mock(() => Promise.resolve({})),
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module("@prisma/client", () => ({
  PrismaClient: class {
    agentConfigAuditLog = mockPrisma.agentConfigAuditLog;
  },
}));

mock.module("../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { logAgentConfigChange, getAgentConfigAuditLogs, getRecentAuditLogs, calculateChanges } =
  await import("../../utils/agent-audit-log");

describe("calculateChanges", () => {
  test("変更のないフィールドは含まないこと", () => {
    const prev = { name: "test", value: 1 };
    const curr = { name: "test", value: 1 };
    expect(calculateChanges(prev, curr)).toEqual({});
  });

  test("変更されたフィールドをfrom/toで返すこと", () => {
    const prev = { name: "old" };
    const curr = { name: "new" };
    const result = calculateChanges(prev, curr);
    expect(result.name).toEqual({ from: "old", to: "new" });
  });

  test("追加されたフィールドを含むこと", () => {
    const prev = {};
    const curr = { newField: "value" };
    const result = calculateChanges(prev, curr);
    expect(result.newField).toEqual({ from: undefined, to: "value" });
  });

  test("削除されたフィールドを含むこと", () => {
    const prev = { removed: "value" };
    const curr = {};
    const result = calculateChanges(prev, curr);
    expect(result.removed).toEqual({ from: "value", to: undefined });
  });

  test("APIキーフィールドはマスクされること", () => {
    const prev = { apiKey: "old-key" };
    const curr = { apiKey: "new-key" };
    const result = calculateChanges(prev, curr);
    expect(result.apiKey).toEqual({ from: "***", to: "***" });
  });

  test("secretフィールドもマスクされること", () => {
    const prev = { clientSecret: "old" };
    const curr = { clientSecret: "new" };
    const result = calculateChanges(prev, curr);
    expect(result.clientSecret).toEqual({ from: "***", to: "***" });
  });

  test("APIキーフィールドが変更されていない場合は含まないこと", () => {
    const prev = { apiKey: "same" };
    const curr = { apiKey: "same" };
    const result = calculateChanges(prev, curr);
    expect(result).toEqual({});
  });

  test("ネストされたオブジェクトの変更を検出すること", () => {
    const prev = { config: { a: 1 } };
    const curr = { config: { a: 2 } };
    const result = calculateChanges(prev, curr);
    expect(result.config).toBeDefined();
  });
});

describe("logAgentConfigChange", () => {
  beforeEach(() => {
    mockPrisma.agentConfigAuditLog.create.mockReset();
    mockPrisma.agentConfigAuditLog.create.mockResolvedValue({});
  });

  test("監査ログを作成すること", async () => {
    await logAgentConfigChange({
      agentConfigId: 1,
      action: "create",
      changeDetails: { name: "test" },
    });
    expect(mockPrisma.agentConfigAuditLog.create).toHaveBeenCalled();
  });

  test("changeDetailsをJSON文字列化して保存すること", async () => {
    await logAgentConfigChange({
      agentConfigId: 1,
      action: "update",
      changeDetails: { key: "value" },
    });
    const call = mockPrisma.agentConfigAuditLog.create.mock.calls[0][0];
    expect(call.data.changeDetails).toBe(JSON.stringify({ key: "value" }));
  });

  test("changeDetailsがない場合nullを保存すること", async () => {
    await logAgentConfigChange({
      agentConfigId: 1,
      action: "delete",
    });
    const call = mockPrisma.agentConfigAuditLog.create.mock.calls[0][0];
    expect(call.data.changeDetails).toBeNull();
  });

  test("DB書き込みエラーでも例外を投げないこと", async () => {
    mockPrisma.agentConfigAuditLog.create.mockRejectedValue(new Error("DB error"));
    await logAgentConfigChange({
      agentConfigId: 1,
      action: "create",
    });
    // should not throw
  });
});

describe("getAgentConfigAuditLogs", () => {
  beforeEach(() => {
    mockPrisma.agentConfigAuditLog.findMany.mockReset();
    mockPrisma.agentConfigAuditLog.findMany.mockResolvedValue([]);
  });

  test("指定IDの監査ログを取得すること", async () => {
    await getAgentConfigAuditLogs(1);
    const call = mockPrisma.agentConfigAuditLog.findMany.mock.calls[0][0];
    expect(call.where.agentConfigId).toBe(1);
    expect(call.orderBy.createdAt).toBe("desc");
    expect(call.take).toBe(50);
  });

  test("カスタムlimitを指定できること", async () => {
    await getAgentConfigAuditLogs(1, 10);
    const call = mockPrisma.agentConfigAuditLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(10);
  });
});

describe("getRecentAuditLogs", () => {
  beforeEach(() => {
    mockPrisma.agentConfigAuditLog.findMany.mockReset();
    mockPrisma.agentConfigAuditLog.findMany.mockResolvedValue([]);
  });

  test("最近の監査ログを取得すること", async () => {
    await getRecentAuditLogs();
    const call = mockPrisma.agentConfigAuditLog.findMany.mock.calls[0][0];
    expect(call.orderBy.createdAt).toBe("desc");
    expect(call.take).toBe(100);
  });

  test("カスタムlimitを指定できること", async () => {
    await getRecentAuditLogs(25);
    const call = mockPrisma.agentConfigAuditLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(25);
  });
});
