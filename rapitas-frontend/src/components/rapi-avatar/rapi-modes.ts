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
const ALWAYS_MODES = ['watch', 'create', 'ask'] as const;
const PANEL_MODES = ['watch', 'create', 'ask', 'consult', 'tidy'] as const;

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
 * 対応待ち one, reused here for the same meanings. The other three are new:
 * see `.claude/icon-policy/`.
 */
export const MODE_ICONS: Record<PanelMode, LucideIcon> = {
  watch: OctagonAlert,
  create: ListPlus,
  ask: ListFilter,
  consult: MessagesSquare,
  tidy: Eraser,
  roadmap: Signpost,
};
