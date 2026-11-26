/**
 * wysiwyg-palette
 *
 * The colour and size choices the note toolbar offers. Every value is a
 * six-digit #RRGGBB (or a px size in 8..72), so whatever is picked is an
 * allowed inline form as it stands.
 * Not responsible for applying them; see wysiwyg-commands.ts.
 */
import { fontSizePresets, textColors } from '../../editor/constants';

/** One highlight choice. */
export interface PaletteColour {
  /** Stable key for the i18n label / 文言のキー */
  key: string;
  /** #RRGGBB in upper case / 大文字の #RRGGBB */
  value: string;
}

// NOTE: yellow is #FFF59D because the task's example names it; the old
// editor's constants.ts highlight palette is left as it is (its tests use it).
export const NOTE_HIGHLIGHT_COLORS: readonly PaletteColour[] = [
  { key: 'yellow', value: '#FFF59D' },
  { key: 'green', value: '#C5E1A5' },
  { key: 'blue', value: '#B3E5FC' },
  { key: 'pink', value: '#F8BBD0' },
  { key: 'orange', value: '#FFE0B2' },
  { key: 'purple', value: '#E1BEE7' },
];

/** Text colours: the old editor's palette, written as upper-case #RRGGBB. */
export const NOTE_TEXT_COLORS: readonly { name: string; value: string }[] = textColors.map((c) => ({
  name: c.name,
  value: c.value.toUpperCase(),
}));

/** Font sizes in px (the old editor's presets, all inside 8..72). */
export const NOTE_FONT_SIZES: readonly number[] = fontSizePresets;
