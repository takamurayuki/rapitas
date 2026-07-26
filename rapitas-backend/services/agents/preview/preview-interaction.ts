/**
 * preview-interaction
 *
 * Relays user interactions (click/type/key/scroll/select) from the embedded
 * live-preview panel to a task's already-running session, and inspects a
 * page-space point before a click so the frontend can special-case a native
 * `<select>` (see inspectPreviewElement's doc comment for why). Reads the
 * `sessions` map preview-session-manager.ts owns; does not create, delete,
 * or otherwise manage session lifecycle itself.
 */
import type { SelectInspection } from '../verification/runtime-smoke/playwright-worker-client';
import { sessions } from './preview-session-manager';

/** A single interaction the preview panel can relay to the live page. */
export type PreviewInteraction =
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; deltaX?: number; deltaY?: number }
  | { action: 'select'; x: number; y: number; value: string };

export type InteractResult =
  | { ok: true }
  | { ok: false; reason: 'not_active' | 'error'; message?: string };

/**
 * Relay a user interaction (click/type/key/scroll/select) to the task's live
 * preview page — makes the embedded panel a real remote control, not just a
 * read-only screenshot viewer.
 *
 * @param taskId - Task whose preview to interact with. / 対象タスクID
 * @param interaction - The action to perform. / 実行する操作
 * @returns Whether the interaction was applied. / 実行結果
 */
export async function interactWithPreview(
  taskId: number,
  interaction: PreviewInteraction,
): Promise<InteractResult> {
  const s = sessions.get(taskId);
  if (!s) return { ok: false, reason: 'not_active' };
  s.lastAccessedAt = new Date();
  try {
    switch (interaction.action) {
      case 'click':
        await s.worker.click({ x: interaction.x, y: interaction.y });
        break;
      case 'type':
        await s.worker.type({ text: interaction.text });
        break;
      case 'key':
        await s.worker.pressKey({ key: interaction.key });
        break;
      case 'scroll':
        await s.worker.scroll({ deltaX: interaction.deltaX, deltaY: interaction.deltaY });
        break;
      case 'select':
        await s.worker.selectOption({
          x: interaction.x,
          y: interaction.y,
          value: interaction.value,
        });
        break;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export type InspectResult =
  | ({ ok: true } & SelectInspection)
  | { ok: false; reason: 'not_active' | 'error'; message?: string };

/**
 * Check whether a page-space point is a `<select>` before the frontend
 * decides how to handle a click — a native select's dropdown is drawn by
 * the OS/browser chrome, never the page itself, so it can't appear in a
 * screenshot and a raw click can't pick an option in it. The frontend calls
 * this first and renders its own dropdown UI when `isSelect` is true instead
 * of relaying a plain click.
 *
 * @param taskId - Task whose preview to inspect. / 対象タスクID
 * @param x - Page-space x coordinate. / X座標
 * @param y - Page-space y coordinate. / Y座標
 * @returns Select details, or a reason the preview isn't available. / 検査結果
 */
export async function inspectPreviewElement(
  taskId: number,
  x: number,
  y: number,
): Promise<InspectResult> {
  const s = sessions.get(taskId);
  if (!s) return { ok: false, reason: 'not_active' };
  s.lastAccessedAt = new Date();
  try {
    const result = await s.worker.inspectSelect({ x, y });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
