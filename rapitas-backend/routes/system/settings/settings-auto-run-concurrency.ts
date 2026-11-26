/**
 * SettingsAutoRunConcurrency
 *
 * Persists UserSettings.autoRunMaxConcurrency (task 1543) and
 * autoRunMaxConcurrencyPerTheme (task 1552), and reports, on the settings
 * response, whether AUTO_RUN_GLOBAL_MAX_CONCURRENCY /
 * AUTO_RUN_THEME_MAX_CONCURRENCY are currently overriding them. Not responsible for resolving the limit used by
 * selection — see services/workflow/auto-run/auto-run-concurrency.ts.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  normalizeAutoRunMaxConcurrency,
  parseEnvAutoRunMaxConcurrency,
  parseEnvAutoRunMaxConcurrencyPerTheme,
} from '../../../services/workflow/auto-run/auto-run-concurrency';
import type { UserSettingsUpdateBody } from './settings-types';

const log = createLogger('routes:settings');

/**
 * Clamp and persist autoRunMaxConcurrency / autoRunMaxConcurrencyPerTheme
 * (task 1552) when the request carries them.
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
  for (const field of ['autoRunMaxConcurrency', 'autoRunMaxConcurrencyPerTheme'] as const) {
    if (body[field] === undefined) continue;
    const clamped = normalizeAutoRunMaxConcurrency(body[field]);
    // One write per column: a failure of the newer column (pending client
    // regeneration) must not take the other one down.
    const saved = await prisma.userSettings
      .update({
        where: { id: settingsId },
        data: { [field]: clamped } as unknown as Parameters<
          typeof prisma.userSettings.update
        >[0]['data'],
      })
      .then(() => true)
      .catch((err) => {
        log.warn({ err }, `${field} persist failed`);
        return false;
      });
    if (saved) settingsRef[field] = clamped;
  }
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
  // Task 1552: per-theme limit, same shape (default 1 when the column is absent).
  settingsRef.autoRunMaxConcurrencyPerTheme = normalizeAutoRunMaxConcurrency(
    settingsRef.autoRunMaxConcurrencyPerTheme,
  );
  settingsRef.autoRunMaxConcurrencyPerThemeEnvOverride = parseEnvAutoRunMaxConcurrencyPerTheme(env);
}
