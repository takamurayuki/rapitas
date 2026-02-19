import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import { createResponse, createErrorResponse } from "../utils/response";

const prisma = new PrismaClient();

// 現在の会計年度を取得（4月開始）
const getCurrentFiscalYear = (date = new Date()): number => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // getMonth() is 0-indexed
  return month >= 4 ? year : year - 1;
};

// 有給日数を計算
const calculateUsedDays = async (userId: string, fiscalYear: number): Promise<number> => {
  const fiscalYearStart = new Date(fiscalYear, 3, 1); // April 1st
  const fiscalYearEnd = new Date(fiscalYear + 1, 2, 31); // March 31st

  const paidLeaveEvents = await prisma.scheduleEvent.findMany({
    where: {
      userId,
      type: "PAID_LEAVE",
      startAt: {
        gte: fiscalYearStart,
        lte: fiscalYearEnd,
      },
    },
  });

  let totalUsedDays = 0;
  for (const event of paidLeaveEvents) {
    const start = new Date(event.startAt);
    const end = event.endAt ? new Date(event.endAt) : start;

    // 日数計算（同日なら1日、複数日なら日数差+1）
    if (event.isAllDay) {
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      totalUsedDays += diffDays;
    } else {
      // 時間指定の場合は0.5日として計算（半日休暇）
      totalUsedDays += 0.5;
    }
  }

  return totalUsedDays;
};

export const paidLeaveRoutes = new Elysia({ prefix: "/paid-leave" })
  // 有給残日数を取得
  .get("/balance", async ({  query  }: any) => {
    try {
      const userId = query.userId || "default";
      const fiscalYear = query.fiscalYear ? parseInt(query.fiscalYear) : getCurrentFiscalYear();

      const fiscalYearStart = new Date(fiscalYear, 3, 1); // April 1st
      const fiscalYearEnd = new Date(fiscalYear + 1, 2, 31); // March 31st

      const paidLeaveEvents = await prisma.scheduleEvent.findMany({
        where: {
          userId,
          type: "PAID_LEAVE",
          startAt: {
            gte: fiscalYearStart,
            lte: fiscalYearEnd,
          },
        },
        orderBy: {
          startAt: "desc",
        },
      });

      // 各イベントに使用日数を追加
      const history = paidLeaveEvents.map((event: typeof paidLeaveEvents[0]) => {
        const start = new Date(event.startAt);
        const end = event.endAt ? new Date(event.endAt) : start;

        let usedDays;
        if (event.isAllDay) {
          const diffTime = end.getTime() - start.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          usedDays = diffDays;
        } else {
          usedDays = 0.5; // 半日休暇
        }

        return {
          ...event,
          usedDays,
        };
      });

      return createResponse(history);
    } catch (error) {
      console.error("Failed to get paid leave history:", error);
      return createErrorResponse("Failed to get paid leave history", 500);
    }
  }, {
    query: t.Object({
      userId: t.Optional(t.String()),
      fiscalYear: t.Optional(t.String()),
    })
  });