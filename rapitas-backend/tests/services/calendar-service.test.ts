/**
 * Calendar Service テスト
 * カレンダーイベントの取得・作成・競合チェックのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockPrisma = {
  scheduleEvent: {
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({ id: 1 })),
  },
};

mock.module("../../config/database", () => ({ prisma: mockPrisma }));
mock.module("../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { getEventsForRange, createEvent, checkConflicts } = await import(
  "../../services/calendar-service"
);

function resetAllMocks() {
  mockPrisma.scheduleEvent.findMany.mockReset();
  mockPrisma.scheduleEvent.create.mockReset();
  mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);
  mockPrisma.scheduleEvent.create.mockResolvedValue({ id: 1 });
}

describe("getEventsForRange", () => {
  beforeEach(resetAllMocks);

  test("指定期間のイベントを返すこと", async () => {
    const events = [
      { id: 1, title: "Meeting", startAt: new Date("2026-03-10T10:00:00Z"), endAt: new Date("2026-03-10T11:00:00Z") },
    ];
    mockPrisma.scheduleEvent.findMany.mockResolvedValue(events);

    const result = await getEventsForRange(new Date("2026-03-10"), new Date("2026-03-11"));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Meeting");
  });

  test("イベントがない場合に空配列を返すこと", async () => {
    const result = await getEventsForRange(new Date("2026-01-01"), new Date("2026-01-02"));
    expect(result).toEqual([]);
  });
});

describe("createEvent", () => {
  beforeEach(resetAllMocks);

  test("イベントを作成できること", async () => {
    const newEvent = {
      id: 2, title: "Study", startAt: new Date("2026-03-15T14:00:00Z"),
      endAt: new Date("2026-03-15T15:00:00Z"), allDay: false, task: null,
    };
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]); // no conflicts
    mockPrisma.scheduleEvent.create.mockResolvedValue(newEvent);

    const result = await createEvent({
      title: "Study",
      startAt: new Date("2026-03-15T14:00:00Z"),
      endAt: new Date("2026-03-15T15:00:00Z"),
    });

    expect(result.event.title).toBe("Study");
    expect(result.conflicts).toHaveLength(0);
  });

  test("競合がある場合もイベントを作成し競合情報を返すこと", async () => {
    const conflict = { id: 5, title: "Existing", startAt: new Date("2026-03-15T14:30:00Z"), endAt: new Date("2026-03-15T15:30:00Z") };
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([conflict]);
    mockPrisma.scheduleEvent.create.mockResolvedValue({
      id: 3, title: "Overlap", startAt: new Date("2026-03-15T14:00:00Z"),
      endAt: new Date("2026-03-15T15:00:00Z"), allDay: false, task: null,
    });

    const result = await createEvent({
      title: "Overlap",
      startAt: new Date("2026-03-15T14:00:00Z"),
      endAt: new Date("2026-03-15T15:00:00Z"),
    });

    expect(result.event.id).toBe(3);
    expect(result.conflicts).toHaveLength(1);
  });
});

describe("checkConflicts", () => {
  beforeEach(resetAllMocks);

  test("競合がない場合に空配列を返すこと", async () => {
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);
    const result = await checkConflicts(
      new Date("2026-03-20T10:00:00Z"),
      new Date("2026-03-20T11:00:00Z"),
    );
    expect(result).toEqual([]);
  });
});
