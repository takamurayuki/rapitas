/**
 * Approvals — Helpers
 *
 * Shared utilities for approval route handlers: JSON field parsing,
 * screenshot data stripping, and the ApprovalWithChanges interface.
 * Not responsible for HTTP route definitions or business logic.
 */

import { createLogger } from '../../../config/logger';
import { fromJsonString } from '../../../utils/db-helpers';

const log = createLogger('routes:approvals:helpers');

/** Prisma approval record with typed JSON fields for parsing. */
export interface ApprovalWithChanges {
  id: number;
  proposedChanges: string | Record<string, unknown> | null;
  estimatedChanges: string | Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * Parse JSON string fields on an approval record and strip the raw diff to reduce response size.
 * The structuredDiff is kept because the front-end DiffViewer uses it.
 * Raw diff can be fetched separately via GET /approvals/:id/diff.
 *
 * @param approval - Raw approval record from Prisma / PrismaからのApprovalレコード
 * @returns Approval with parsed JSON fields and diff stripped, or null if input is null
 */
export function parseApprovalJsonFields(approval: ApprovalWithChanges | null) {
  if (!approval) return approval;

  let proposedChanges = approval.proposedChanges;
  if (typeof proposedChanges === 'string') {
    proposedChanges = fromJsonString(proposedChanges);
    if (proposedChanges === null) {
      log.error(`[approvals] Failed to parse proposedChanges for approval ${approval.id}`);
      proposedChanges = {};
    }
  }

  // NOTE: Exclude raw diff (plain text) from proposedChanges to reduce response size.
  // structuredDiff is kept because the front-end DiffViewer uses it.
  // Raw diff can be fetched separately via /approvals/:id/diff.
  const parsedChanges = (proposedChanges || {}) as Record<string, unknown>;
  const { diff: _diff, ...proposedChangesWithoutDiff } = parsedChanges;

  let estimatedChanges =
    typeof approval.estimatedChanges === 'string'
      ? fromJsonString(approval.estimatedChanges)
      : approval.estimatedChanges;
  // Also exclude diff from estimatedChanges
  if (estimatedChanges && typeof estimatedChanges === 'object' && 'diff' in estimatedChanges) {
    const { diff: _estDiff, ...estWithoutDiff } = estimatedChanges as Record<string, unknown>;
    estimatedChanges = estWithoutDiff;
  }

  const parsed = {
    ...approval,
    proposedChanges: proposedChangesWithoutDiff,
    estimatedChanges,
  };

  // Debug logging for screenshot presence
  const screenshots = parsed.proposedChanges?.screenshots as Array<{ url: string }> | undefined;
  if (screenshots && screenshots.length > 0) {
    log.info(
      `[approvals] Approval ${approval.id} has ${screenshots.length} screenshot(s): ${screenshots.map((s) => s.url).join(', ')}`,
    );
  } else {
    log.info(
      `[approvals] Approval ${approval.id} has no screenshots. Keys: ${Object.keys(parsed.proposedChanges || {}).join(', ')}`,
    );
  }
  return parsed;
}
