/**
 * SettingsExtraFields
 *
 * Persistence helpers for user-settings fields that live outside the typed
 * Prisma client: columns pending client regeneration (written via cast) and
 * the file-backed autoRestartOnMergedCode toggle (no DB column at all —
 * schema changes were prohibited for that feature).
 * Not responsible for HTTP routing or validation; see settings-routes.ts.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  readAutoRestartEnabled,
  writeAutoRestartEnabled,
} from '../../../services/scheduling/auto-restart-merged-code/settings-store';
import {
  readRetroReviewEnabled,
  writeRetroReviewEnabled,
} from '../../../services/workflow/process-retro/retro-settings-store';
import type { UserSettingsUpdateBody } from './settings-types';

const log = createLogger('routes:settings');

/**
 * Persist the "pending client regeneration" columns via cast writes: the
 * Prisma client type does not include these columns until it is regenerated
 * (on the next backend restart), so write them through a cast to keep this
 * compiling now. The values still land in the row the same way once the
 * columns exist. Applied values are mirrored onto `settingsRef` so the PATCH
 * response reflects them immediately.
 *
 * @param settingsId - UserSettings row id / 対象UserSettings行のid
 * @param body - PATCH body (only defined fields are written) / PATCHボディ
 * @param settingsRef - Response object to mirror applied values onto / 反映先レスポンスオブジェクト
 */
export async function applyPendingClientColumns(
  settingsId: number,
  body: UserSettingsUpdateBody,
  settingsRef: Record<string, unknown>,
): Promise<void> {
  const { restartOnAutoRunDry, verifyRepairLimit, workflowDisabledGlobally } = body;

  if (restartOnAutoRunDry !== undefined) {
    await prisma.userSettings
      .update({
        where: { id: settingsId },
        data: { restartOnAutoRunDry } as unknown as Parameters<
          typeof prisma.userSettings.update
        >[0]['data'],
      })
      .catch((err) => log.warn({ err }, 'restartOnAutoRunDry persist failed'));
    settingsRef.restartOnAutoRunDry = restartOnAutoRunDry;
  }

  if (verifyRepairLimit !== undefined) {
    // Clamp to a sane 0..10 range.
    const clamped = Math.max(0, Math.min(10, Math.floor(verifyRepairLimit)));
    await prisma.userSettings
      .update({
        where: { id: settingsId },
        data: { verifyRepairLimit: clamped } as unknown as Parameters<
          typeof prisma.userSettings.update
        >[0]['data'],
      })
      .catch((err) => log.warn({ err }, 'verifyRepairLimit persist failed'));
    settingsRef.verifyRepairLimit = clamped;
  }

  if (workflowDisabledGlobally !== undefined) {
    await prisma.userSettings
      .update({
        where: { id: settingsId },
        data: { workflowDisabledGlobally } as unknown as Parameters<
          typeof prisma.userSettings.update
        >[0]['data'],
      })
      .catch((err) => log.warn({ err }, 'workflowDisabledGlobally persist failed'));
    settingsRef.workflowDisabledGlobally = workflowDisabledGlobally;
  }
}

/**
 * Persist the file-backed autoRestartOnMergedCode toggle (no Prisma column —
 * the value lives in RAPITAS_DATA_DIR) and mirror the effective value onto
 * `settingsRef` so GET/PATCH responses always carry the field.
 *
 * @param body - PATCH body (field written only when defined) / PATCHボディ
 * @param settingsRef - Response object to mirror the value onto / 反映先レスポンスオブジェクト
 */
export function applyAutoRestartOnMergedCode(
  body: UserSettingsUpdateBody,
  settingsRef: Record<string, unknown>,
): void {
  if (body.autoRestartOnMergedCode !== undefined) {
    writeAutoRestartEnabled(body.autoRestartOnMergedCode);
  }
  settingsRef.autoRestartOnMergedCode = readAutoRestartEnabled();
}

/**
 * Persist the file-backed retroReviewEnabled toggle (no Prisma column — the
 * value lives in RAPITAS_DATA_DIR, default ON) and mirror the effective value
 * onto `settingsRef` so GET/PATCH responses always carry the field.
 *
 * @param body - PATCH body (field written only when defined) / PATCHボディ
 * @param settingsRef - Response object to mirror the value onto / 反映先レスポンスオブジェクト
 */
export function applyRetroReviewEnabled(
  body: UserSettingsUpdateBody,
  settingsRef: Record<string, unknown>,
): void {
  if (body.retroReviewEnabled !== undefined) {
    writeRetroReviewEnabled(body.retroReviewEnabled);
  }
  settingsRef.retroReviewEnabled = readRetroReviewEnabled();
}
