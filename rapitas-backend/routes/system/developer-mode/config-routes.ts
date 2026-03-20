/**
 * DeveloperMode Config Routes
 *
 * CRUD routes for DeveloperModeConfig: enable, disable, and update configuration.
 * Does not include AI-powered analysis or prompt generation endpoints.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:developer-mode:config');

/**
 * Routes handling developer mode lifecycle and config for a task.
 *
 * @returns Elysia instance with prefix /developer-mode
 */
export const developerModeConfigRoutes = new Elysia({ prefix: '/developer-mode' })

  .get('/config/:taskId', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.taskId);
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        agentSessions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        approvalRequests: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return config;
  })

  .post('/enable/:taskId', async (context) => {
    const { params, body } = context;
    const taskId = parseInt(params.taskId);
    const { autoApprove, maxSubtasks, priority } = body as {
      autoApprove?: boolean;
      maxSubtasks?: number;
      priority?: string;
    };

    await prisma.task.update({
      where: { id: taskId },
      data: { isDeveloperMode: true },
    });

    let config;
    try {
      config = await prisma.developerModeConfig.upsert({
        where: { taskId },
        update: {
          isEnabled: true,
          ...(autoApprove !== undefined && { autoApprove }),
          ...(maxSubtasks !== undefined && { maxSubtasks }),
          ...(priority !== undefined && { priority }),
        },
        create: {
          taskId,
          isEnabled: true,
          autoApprove: autoApprove ?? false,
          maxSubtasks: maxSubtasks ?? 10,
          priority: priority ?? 'balanced',
        },
      });
    } catch (upsertError: unknown) {
      // NOTE: Prisma upsert can race under concurrent requests — both see no row, both try to create, one gets P2002.
      const isPrismaUniqueViolation =
        upsertError instanceof Error &&
        'code' in upsertError &&
        (upsertError as { code: string }).code === 'P2002';
      if (isPrismaUniqueViolation) {
        log.warn(`[API] Concurrent upsert race for taskId=${taskId}, updating existing record`);
        config = await prisma.developerModeConfig.update({
          where: { taskId },
          data: {
            isEnabled: true,
            ...(autoApprove !== undefined && { autoApprove }),
            ...(maxSubtasks !== undefined && { maxSubtasks }),
            ...(priority !== undefined && { priority }),
          },
        });
      } else {
        throw upsertError;
      }
    }

    return config;
  })

  .delete('/disable/:taskId', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.taskId);

    await prisma.task.update({
      where: { id: taskId },
      data: { isDeveloperMode: false },
    });

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (config) {
      await prisma.developerModeConfig.update({
        where: { taskId },
        data: { isEnabled: false },
      });
    }

    return { success: true };
  })

  .patch('/config/:taskId', async (context) => {
    const { params, body } = context;
    const taskId = parseInt(params.taskId);
    const { autoApprove, notifyInApp, maxSubtasks, priority } = body as {
      autoApprove?: boolean;
      notifyInApp?: boolean;
      maxSubtasks?: number;
      priority?: string;
    };

    return await prisma.developerModeConfig.update({
      where: { taskId },
      data: {
        ...(autoApprove !== undefined && { autoApprove }),
        ...(notifyInApp !== undefined && { notifyInApp }),
        ...(maxSubtasks !== undefined && { maxSubtasks }),
        ...(priority !== undefined && { priority }),
      },
    });
  })

  .get('/sessions/:taskId', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.taskId);

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (!config) {
      return [];
    }

    return await prisma.agentSession.findMany({
      where: { configId: config.id },
      include: {
        agentActions: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  });
