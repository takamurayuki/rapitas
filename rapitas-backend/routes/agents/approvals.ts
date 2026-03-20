/**
 * Approvals API Routes
 *
 * Re-exports from the approvals sub-module directory.
 * Maintained for backward compatibility — import approvalsRoutes from this path as before.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { parseId } from '../../middleware/error-handler';
import { orchestrator } from '../../services/orchestrator-instance';
import { parseApprovalJsonFields } from './approvals/helpers';
import { approveRoutes } from './approvals/approve-handler';
import { bulkApproveRoutes } from './approvals/bulk-approve-handler';
import { rejectRoutes } from './approvals/reject-handler';
import { codeReviewRoutes } from './approvals/code-review-handler';

// Re-export orchestrator for backward compatibility
export { orchestrator };

const log = createLogger('routes:approvals');

export const approvalsRoutes = new Elysia({ prefix: '/approvals' })
  // Get approval list
  .get('/', async (context) => {
    const { query } = context;
    const { status } = query as { status?: string };
    const approvals = await prisma.approvalRequest.findMany({
      where: status ? { status } : { status: 'pending' },
      include: {
        config: {
          include: {
            task: {
              include: {
                theme: {
                  select: {
                    defaultBranch: true,
                    workingDirectory: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return approvals.map(parseApprovalJsonFields);
  })

  // Get approval details
  .get('/:id', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    const approvalId = parseId(id, 'approval ID');
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        config: {
          include: {
            task: {
              include: {
                theme: {
                  select: {
                    defaultBranch: true,
                    workingDirectory: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return parseApprovalJsonFields(approval);
  })

  .use(approveRoutes)
  .use(bulkApproveRoutes)
  .use(rejectRoutes)
  .use(codeReviewRoutes);
