/**
 * ime
 *
 * IME composition guard for keyboard handlers on text inputs. The Enter that
 * CONFIRMS a Japanese conversion (and every other key routed through an IME)
 * must never trigger submit/save actions — without this guard, confirming a
 * conversion in any Enter-to-save field submits the half-converted text.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Whether the keyboard event belongs to an active IME composition.
 *
 * @param e - React or native keyboard event / Reactまたはネイティブのキーイベント
 * @returns True when the key is part of an IME composition / IME合成中ならtrue
 */
export function isImeComposing(e: ReactKeyboardEvent<Element> | KeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  // keyCode 229 is the legacy composition marker — kept alongside isComposing
  // because WebView2/browsers disagree on which one is set for the final
  // conversion-confirm Enter.
  return native.isComposing || native.keyCode === 229;
}
