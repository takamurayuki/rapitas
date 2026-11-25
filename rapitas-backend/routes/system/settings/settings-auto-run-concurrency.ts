/**
 * SettingsAutoRunConcurrency
 *
 * Persists UserSettings.autoRunMaxConcurrency (task 1543) and reports, on the
 * settings response, whether the AUTO_RUN_GLOBAL_MAX_CONCURRENCY env var is
 * currently overriding it. Not responsible for resolving the limit used by
 * selection — see services/workflow/auto-run/auto-run-concurrency.ts.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  normalizeAutoRunMaxConcurrency,
  parseEnvAutoRunMaxConcurrency,
} from '../../../services/workflow/auto-run/auto-run-concurrency';
import type { UserSettingsUpdateBody } from './settings-types';

const log = createLogger('routes:settings');

/**
 * Clamp and persist autoRunMaxConcurrency when the request carries it.
 * Written through a cast because the column is pending client regeneration;
 * a failed write is logged and the response keeps the previous value.
 *
 * @param settingsId - UserSettings row id / 設定行のID
 * @param body - PATCH body / 更新リクエスト本文
 * @param settingsRef - Response object to update in place / その場で更新する応答オブジェクト
 */
export async function applyAutoRunMaxConcurrency(
  settingsId: number,
  body: UserSettingsUpdateBody,
  settingsRef: Record<string, unknown>,
): Promise<void> {
  if (body.autoRunMaxConcurrency === undefined) return;
  const clamped = normalizeAutoRunMaxConcurrency(body.autoRunMaxConcurrency);
  const saved = await prisma.userSettings
    .update({
      where: { id: settingsId },
      data: { autoRunMaxConcurrency: clamped } as unknown as Parameters<
        typeof prisma.userSettings.update
      >[0]['data'],
    })
    .then(() => true)
    .catch((err) => {
      log.warn({ err }, 'autoRunMaxConcurrency persist failed');
      return false;
    });
  if (saved) settingsRef.autoRunMaxConcurrency = clamped;
}

/**
 * Normalize autoRunMaxConcurrency on the response (a row read before the column
 * exists has none) and add the env override, so the UI can say the saved value
 * is not in effect.
 *
 * @param settingsRef - Response object to update in place / その場で更新する応答オブジェクト
 * @param env - Environment (injectable for tests) / 環境変数
 */
export function applyAutoRunConcurrencyEnvInfo(
  settingsRef: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): void {
  settingsRef.autoRunMaxConcurrency = normalizeAutoRunMaxConcurrency(
    settingsRef.autoRunMaxConcurrency,
  );
  settingsRef.autoRunMaxConcurrencyEnvOverride = parseEnvAutoRunMaxConcurrency(env);
}
