import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createResponse, createErrorResponse } from '../../utils/common/response';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:paid-leave');

// Get current fiscal year (starts April)
const getCurrentFiscalYear = (date = new Date()): number => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // getMonth() is 0-indexed
  return month >= 4 ? year : year - 1;
};

// Calculate used paid leave days
const calculateUsedDays = async (userId: string, fiscalYear: number): Promise<number> => {
  const fiscalYearStart = new Date(fiscalYear, 3, 1); // April 1st
  const fiscalYearEnd = new Date(fiscalYear + 1, 2, 31); // March 31st

  const paidLeaveEvents = await prisma.scheduleEvent.findMany({
    where: {
      userId,
      type: 'PAID_LEAVE',
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

    // Day count: same day = 1, multi-day = diff + 1
    if (event.isAllDay) {
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      totalUsedDays += diffDays;
    } else {
      // Time-specified events count as 0.5 days (half-day leave)
      totalUsedDays += 0.5;
    }
  }

  return totalUsedDays;
};

export const paidLeaveRoutes = new Elysia({ prefix: '/paid-leave' })
  // Get remaining paid leave balance
  .get(
    '/balance',
    async (context) => {
      const { query } = context;
      try {
        const userId = query.userId || 'default';
        const fiscalYear = query.fiscalYear ? parseInt(query.fiscalYear) : getCurrentFiscalYear();

        let balance = await prisma.paidLeaveBalance.findUnique({
          where: {
            userId_fiscalYear: {
              userId,
              fiscalYear,
            },
          },
        });

        if (!balance) {
          // First-time creation: default 20 days minus used days
          const usedDays = await calculateUsedDays(userId, fiscalYear);
          const remainingDays = 20 - usedDays;

          balance = await prisma.paidLeaveBalance.create({
            data: {
              userId,
              fiscalYear,
              totalDays: 20,
              usedDays,
              remainingDays,
            },
          });
        } else {
          // Recalculate used days and update
          const usedDays = await calculateUsedDays(userId, fiscalYear);
          const remainingDays = balance.totalDays + balance.carryOverDays - usedDays;

          balance = await prisma.paidLeaveBalance.update({
            where: { id: balance.id },
            data: {
              usedDays,
              remainingDays,
              lastCalculatedAt: new Date(),
            },
          });
        }

        return createResponse(balance);
      } catch (error) {
        log.error({ err: error }, 'Failed to get paid leave balance');
        return createErrorResponse('Failed to get paid leave balance');
      }
    },
    {
      query: t.Object({
        userId: t.Optional(t.String()),
        fiscalYear: t.Optional(t.String()),
      }),
    },
  )

  // Update paid leave balance
  .put(
    '/balance',
    async (context) => {
      const { body } = context;
      try {
        const {
          userId = 'default',
          fiscalYear,
          totalDays,
          carryOverDays,
        } = body as {
          userId?: string;
          fiscalYear?: number;
          totalDays?: number;
          carryOverDays?: number;
        };
        const targetYear = fiscalYear || getCurrentFiscalYear();

        const balance = await prisma.paidLeaveBalance.upsert({
          where: {
            userId_fiscalYear: {
              userId,
              fiscalYear: targetYear,
            },
          },
          update: {
            totalDays: totalDays || 20,
            carryOverDays: carryOverDays || 0,
            lastCalculatedAt: new Date(),
          },
          create: {
            userId,
            fiscalYear: targetYear,
            totalDays: totalDays || 20,
            usedDays: 0,
            remainingDays: (totalDays || 20) + (carryOverDays || 0),
            carryOverDays: carryOverDays || 0,
          },
        });

        const usedDays = await calculateUsedDays(userId, targetYear);
        const remainingDays = balance.totalDays + balance.carryOverDays - usedDays;

        const updatedBalance = await prisma.paidLeaveBalance.update({
          where: { id: balance.id },
          data: {
            usedDays,
            remainingDays,
            lastCalculatedAt: new Date(),
          },
        });

        return createResponse(updatedBalance);
      } catch (error) {
        log.error({ err: error }, 'Failed to update paid leave balance');
        return createErrorResponse('Failed to update paid leave balance');
      }
    },
    {
      body: t.Object({
        userId: t.Optional(t.String()),
        fiscalYear: t.Optional(t.Number()),
        totalDays: t.Optional(t.Number()),
        carryOverDays: t.Optional(t.Number()),
      }),
    },
  )

  // Get paid leave history
  .get(
    '/history',
    async (context) => {
      const { query } = context;
      try {
        const userId = query.userId || 'default';
        const fiscalYear = query.fiscalYear ? parseInt(query.fiscalYear) : getCurrentFiscalYear();

        const fiscalYearStart = new Date(fiscalYear, 3, 1); // April 1st
        const fiscalYearEnd = new Date(fiscalYear + 1, 2, 31); // March 31st

        const paidLeaveEvents = await prisma.scheduleEvent.findMany({
          where: {
            userId,
            type: 'PAID_LEAVE',
            startAt: {
              gte: fiscalYearStart,
              lte: fiscalYearEnd,
            },
          },
          orderBy: {
            startAt: 'desc',
          },
        });

        // Attach used days count to each event
        const history = paidLeaveEvents.map((event: (typeof paidLeaveEvents)[0]) => {
          const start = new Date(event.startAt);
          const end = event.endAt ? new Date(event.endAt) : start;

          let usedDays;
          if (event.isAllDay) {
            const diffTime = end.getTime() - start.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            usedDays = diffDays;
          } else {
            usedDays = 0.5; // half-day leave
          }

          return {
            ...event,
            usedDays,
          };
        });

        return createResponse(history);
      } catch (error) {
        log.error({ err: error }, 'Failed to get paid leave history');
        return createErrorResponse('Failed to get paid leave history');
      }
    },
    {
      query: t.Object({
        userId: t.Optional(t.String()),
        fiscalYear: t.Optional(t.String()),
      }),
    },
  );
