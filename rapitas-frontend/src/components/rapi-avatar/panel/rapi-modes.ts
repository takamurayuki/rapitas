/**
 * RapiModes
 *
 * The kinds of request ラピ can route a sentence to, and the glyph each is
 * shown with in the conversation's routing note.
 *
 * There used to be a tab per mode and a fallback for which tabs existed
 * where. Every mode is reached by writing to her now (2026-11-14), so what
 * is left is the list and the glyphs.
 */
import {
  Eraser,
  ListFilter,
  ListPlus,
  Locate,
  OctagonAlert,
  Pencil,
  Signpost,
  type LucideIcon,
} from 'lucide-react';
import type { PromptDestination } from './RapiPrompt';

/** A mode a sentence can be routed to. */
export type PanelMode = PromptDestination;

/**
 * One glyph per mode, beside the note that says where a sentence went.
 *
 * `ListPlus` is the app's established 起票 glyph, `OctagonAlert` its 対応待ち
 * one and `Pencil` its edit one, reused here for the same meanings. The
 * others are recorded in `.claude/icon-policy/`.
 */
export const MODE_ICONS: Record<PanelMode, LucideIcon> = {
  watch: OctagonAlert,
  create: ListPlus,
  ask: ListFilter,
  consult: Locate,
  tidy: Eraser,
  roadmap: Signpost,
  change: Pencil,
};
