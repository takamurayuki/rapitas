/**
 * ThemeAutoRunPriority
 *
 * Persists Theme.autoRunPriority (task 1543) after a theme create/update.
 * Kept out of the main create/update data because the generated client may
 * predate the column, and naming it there would fail the whole request.
 * Not responsible for how the priority is used — see auto-run-concurrency.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { normalizeThemeAutoRunPriority } from '../../services/workflow/auto-run/auto-run-concurrency';

const log = createLogger('routes:themes');

/**
 * Clamp and save a theme's autoRunPriority, reflecting it on the response.
 * A failed write is logged and the response keeps its previous value.
 *
 * @param id - Theme id / テーマID
 * @param value - Submitted priority, or undefined to leave it as is / 送られた優先度（undefined なら変更しない）
 * @param themeRef - Theme returned to the client / クライアントへ返すテーマ
 * @returns The same theme object / 同じテーマオブジェクト
 */
export async function persistThemeAutoRunPriority<T extends object>(
  id: number,
  value: unknown,
  themeRef: T,
): Promise<T> {
  if (value === undefined) return themeRef;
  const clamped = normalizeThemeAutoRunPriority(value);
  const saved = await prisma.theme
    .update({
      where: { id },
      data: { autoRunPriority: clamped } as unknown as Parameters<
        typeof prisma.theme.update
      >[0]['data'],
    })
    .then(() => true)
    .catch((err: unknown) => {
      log.warn({ err, themeId: id }, 'autoRunPriority persist failed');
      return false;
    });
  if (saved) (themeRef as Record<string, unknown>).autoRunPriority = clamped;
  return themeRef;
}
