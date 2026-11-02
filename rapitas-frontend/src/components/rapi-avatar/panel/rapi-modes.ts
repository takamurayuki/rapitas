/**
 * RapiModes
 *
 * What ラピ can be asked for, and which of those get a button.
 *
 * Lifted out of the panel so the panel can stay about drawing. The split in
 * here is the important part: a mode can be reachable without costing a tab,
 * because the single input routes by intent and the bar is only the
 * shortcuts beside it.
 */
import {
  Eraser,
  ListFilter,
  ListPlus,
  Locate,
  MessagesSquare,
  OctagonAlert,
  Signpost,
  type LucideIcon,
} from 'lucide-react';

/**
 * Five, not six: "AIで選ぶ" and "条件で選ぶ" were one job described twice and
 * are now the two instruments inside `tidy`. And `consult` is only offered
 * where it can work — it is the one mode that needs a task open, and a tab
 * whose whole content is "open a task first" spends a fifth of the bar
 * saying so.
 */
/**
 * `chat` leads, and is where the panel opens.
 *
 * Everything else on the bar is a form or a list; this one answers a
 * sentence, which is what the box at the bottom is for. Keeping the
 * conversation in its own place is what lets the greeting live there too,
 * instead of taking the first two lines of every list (asked for
 * 2026-10-22).
 */
const ALWAYS_MODES = ['chat', 'watch', 'create', 'ask'] as const;
const PANEL_MODES = ['chat', 'watch', 'create', 'ask', 'consult', 'tidy'] as const;

/**
 * Reachable by typing, but not a tab.
 *
 * This is what the single input bought. `roadmap` is a whole mode — a plan
 * drafted, questioned, then created — and it costs the tab bar nothing,
 * which is the shape every capability after this one should take.
 */
const TYPED_ONLY_MODES = ['roadmap'] as const;

/**
 * How many past questions the session history keeps.
 *
 * A way back to something, not a transcript: the row it draws is one line
 * in a 320px panel, and the tab bar was just cut from two rows to one.
 */
export const MAX_HISTORY = 8;

export type PanelMode = (typeof PANEL_MODES)[number] | (typeof TYPED_ONLY_MODES)[number];

/**
 * The tabs to show, given whether a task is open.
 *
 * @param hasTask - Whether a task is open on the page or in the panel / タスクが開いているか
 * @returns The modes to offer, in order / 表示するモード
 */
export function visibleModes(hasTask: boolean): readonly PanelMode[] {
  return hasTask ? PANEL_MODES : ([...ALWAYS_MODES, 'tidy'] as const);
}

/** Where the panel opens, and where it falls back to. */
export const DEFAULT_MODE: PanelMode = 'chat';

/**
 * Every mode that can be reached right now, tab or not.
 *
 * Wider than the bar, because a typed sentence can land somewhere no button
 * goes. The fallback has to use this one: falling back merely because a mode
 * has no tab would bounce the user straight out of the roadmap they just
 * asked for.
 *
 * @param hasTask - Whether a task is open / タスクが開いているか
 * @returns The modes that can be shown / 表示しうるモード
 */
export function reachableModes(hasTask: boolean): readonly PanelMode[] {
  return [...visibleModes(hasTask), ...TYPED_ONLY_MODES];
}

/**
 * One glyph per mode, so the bar fits on a single line.
 *
 * Four text tabs wrapped onto two rows in a 320px bubble — measured at 49px
 * of height before a word of content. Only the mode you are in keeps its
 * label now, which is also the only label you need: the rest are shortcuts
 * you already know or can hover.
 *
 * `ListPlus` is the app's established 起票 glyph and `OctagonAlert` its
 * 対応待ち one, reused here for the same meanings. The others are new:
 * see `.claude/icon-policy/`.
 *
 * `MessagesSquare` moved from `consult` to `chat` on 2026-10-22: it reads as
 * "talking", which is what the new tab is, and said nothing about "the task
 * you have open". `consult` took `Locate` instead — one thing, singled out.
 */
export const MODE_ICONS: Record<PanelMode, LucideIcon> = {
  chat: MessagesSquare,
  watch: OctagonAlert,
  create: ListPlus,
  ask: ListFilter,
  consult: Locate,
  tidy: Eraser,
  roadmap: Signpost,
};
