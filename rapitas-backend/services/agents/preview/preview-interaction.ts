/**
 * preview-interaction
 *
 * Relays user interactions (click/type/key/scroll/select) from the embedded
 * live-preview panel to a task's already-running session. clickPreview also
 * inspects a page-space point before relaying a click so the frontend can
 * special-case a native `<select>` (see its doc comment for why), all in one
 * round trip. Reads the `sessions` map preview-session-manager.ts owns; does
 * not create, delete, or otherwise manage session lifecycle itself.
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

export type ClickResult =
  | ({ ok: true; isSelect: true } & Omit<SelectInspection, 'isSelect'>)
  | { ok: true; isSelect: false; buffer: Buffer }
  | { ok: false; reason: 'not_active' | 'error'; message?: string };

/**
 * Click at a page-space point and return the resulting frame in one round
 * trip. Inspects the point first — a native `<select>`'s dropdown is drawn
 * by the OS/browser chrome, never the page itself, so it can't appear in a
 * screenshot and a raw click can't pick an option in it — and only when the
 * point isn't a select does it relay the click and take a follow-up
 * screenshot. Previously the frontend made this decision itself via a
 * separate inspect call, paying for three sequential HTTP+worker round
 * trips (inspect, click, screenshot) on every non-select click instead of
 * one.
 *
 * @param taskId - Task whose preview to click. / 対象タスクID
 * @param x - Page-space x coordinate. / X座標
 * @param y - Page-space y coordinate. / Y座標
 * @returns Select details (no click relayed), the post-click screenshot, or a reason the preview isn't available. / クリック結果
 */
export async function clickPreview(taskId: number, x: number, y: number): Promise<ClickResult> {
  const s = sessions.get(taskId);
  if (!s) return { ok: false, reason: 'not_active' };
  s.lastAccessedAt = new Date();
  try {
    const inspection = await s.worker.inspectSelect({ x, y });
    if (inspection.isSelect) {
      return {
        ok: true,
        isSelect: true,
        value: inspection.value,
        rect: inspection.rect,
        options: inspection.options,
      };
    }
    await s.worker.click({ x, y });
    const buffer = await s.worker.screenshot();
    return { ok: true, isSelect: false, buffer };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
