/**
 * markdown-density
 *
 * How tightly `MarkdownView` sets its text. `document` is the workflow file
 * viewer's rhythm (large headings, generous margins); `chat` fits a reply
 * inside a narrow chat bubble — headings barely above the body, short
 * margins, no heading rules — so a reply with a heading and a list does not
 * look like a page dropped into the conversation. `note` is a note body,
 * set to match the phone's note detail (NoteContentMarkdown in rapitas-mobile)
 * so the same note reads the same on both.
 */
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

/** The densities `MarkdownView` accepts. / 体裁の密度 */
export type MarkdownDensity = 'document' | 'chat' | 'note';

// NOTE: these sit on the wrapper and reach into the rendered elements, so
// they must out-rank the per-element classes in MarkdownView (`!mt-8`,
// `text-lg`, `border-b` …). `[&_h2]:!mt-3` (class + element) beats `!mt-8`
// (class only) at equal importance.
const CHAT_DENSITY_CLASS = [
  'text-sm leading-relaxed',
  '[&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0',
  '[&_p]:!my-1.5',
  '[&_h1]:!mt-3 [&_h1]:!mb-1.5 [&_h1]:!pb-0 [&_h1]:!border-b-0 [&_h1]:!text-[15px]',
  '[&_h2]:!mt-3 [&_h2]:!mb-1 [&_h2]:!pb-0 [&_h2]:!border-b-0 [&_h2]:!text-[14.5px] [&_h2]:!gap-1.5 [&_h2]:before:!h-3.5 [&_h2]:before:!w-[3px]',
  '[&_h3]:!mt-2.5 [&_h3]:!mb-1 [&_h3]:!text-sm',
  '[&_h4]:!mt-2 [&_h4]:!mb-1',
  '[&_ul]:!my-1.5 [&_ol]:!my-1.5 [&_ul]:!pl-4.5 [&_ol]:!pl-5',
  '[&_pre]:!my-2 [&_pre]:!p-2.5',
  '[&_blockquote]:!my-2 [&_blockquote]:!py-1.5 [&_blockquote]:!pl-3',
  '[&_hr]:!my-3',
  '[&_table]:!text-[12px]',
  '[&_div:has(>table)]:!my-2',
].join(' ');

// NOTE: values follow the phone's style sheet (buildTaskDescriptionStyleSheet):
// body 14px; h1/h2/h3 = titleLarge 22 / titleMedium 16 / titleSmall 14, bold,
// body colour, no rules or accent bar; links underlined; code 0.9em on a grey
// box with 8px corners and 12px padding; every table cell bordered, 8px/6px
// padding, body-size text; quotes with a 3px accent bar on a grey ground.
// The phone has no heading rules, so the H2 bar and borders are switched off.
const NOTE_DENSITY_CLASS = [
  'text-sm leading-normal',
  '[&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0',
  '[&_p]:!my-2 [&_p]:!leading-normal',
  '[&_h1]:!mt-5 [&_h1]:!mb-2 [&_h1]:!pb-0 [&_h1]:!border-b-0 [&_h1]:!text-[22px] [&_h1]:!font-bold',
  '[&_h2]:!mt-5 [&_h2]:!mb-2 [&_h2]:!pb-0 [&_h2]:!border-b-0 [&_h2]:!text-base [&_h2]:!font-bold [&_h2]:before:!hidden',
  '[&_h3]:!mt-4 [&_h3]:!mb-1.5 [&_h3]:!text-sm [&_h3]:!font-bold [&_h3]:!text-zinc-900 dark:[&_h3]:!text-zinc-100',
  '[&_h4]:!mt-3 [&_h4]:!mb-1 [&_h4]:!text-sm [&_h4]:!font-bold',
  '[&_ul]:!my-2 [&_ol]:!my-2 [&_li]:!my-0.5',
  '[&_a]:!underline [&_a]:underline-offset-2',
  '[&_pre]:!my-3 [&_pre]:!p-3 [&_pre]:!rounded-lg [&_pre]:!text-[12.6px]',
  '[&_blockquote]:!my-3 [&_blockquote]:!py-2 [&_blockquote]:!pl-3 [&_blockquote]:!border-l-[3px] [&_blockquote]:!border-indigo-500 [&_blockquote]:!bg-zinc-100 [&_blockquote]:!rounded-sm dark:[&_blockquote]:!bg-zinc-800/60',
  '[&_hr]:!my-4',
  '[&_div:has(>table)]:!my-3 [&_div:has(>table)]:!rounded-none [&_div:has(>table)]:!border-0',
  '[&_table]:!text-sm',
  '[&_th]:!border [&_td]:!border [&_th]:!border-zinc-300 [&_td]:!border-zinc-300 dark:[&_th]:!border-zinc-600 dark:[&_td]:!border-zinc-600',
  '[&_th]:!px-2 [&_th]:!py-1.5 [&_td]:!px-2 [&_td]:!py-1.5 [&_th]:!font-semibold [&_th]:!text-zinc-900 dark:[&_th]:!text-zinc-100',
].join(' ');

/**
 * Wrapper classes for a density.
 *
 * @param density - The requested density / 体裁の密度
 * @returns Extra wrapper classes; empty for `document` / 追加クラス（document は空）
 */
export function densityClass(density: MarkdownDensity): string {
  if (density === 'chat') return CHAT_DENSITY_CLASS;
  if (density === 'note') return NOTE_DENSITY_CLASS;
  return '';
}

const DEFAULT_REMARK_PLUGINS = [remarkGfm];
// The phone renders notes with softLineBreak, so a single newline breaks the
// line there; without remark-breaks the same note would run lines together here.
const NOTE_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * The remark plugins a density parses with. Stable arrays, so a re-render
 * never hands react-markdown a new plugin list.
 *
 * @param density - The requested density / 体裁の密度
 * @returns remark plugins for react-markdown / react-markdown に渡す remark プラグイン
 */
export function remarkPluginsFor(density: MarkdownDensity) {
  return density === 'note' ? NOTE_REMARK_PLUGINS : DEFAULT_REMARK_PLUGINS;
}
