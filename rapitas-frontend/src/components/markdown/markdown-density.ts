/**
 * markdown-density
 *
 * How tightly `MarkdownView` sets its text. `document` is the workflow file
 * viewer's rhythm (large headings, generous margins); `chat` fits a reply
 * inside a narrow chat bubble — headings barely above the body, short
 * margins, no heading rules — so a reply with a heading and a list does not
 * look like a page dropped into the conversation.
 */

/** The densities `MarkdownView` accepts. / 体裁の密度 */
export type MarkdownDensity = 'document' | 'chat';

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

/**
 * Wrapper classes for a density.
 *
 * @param density - The requested density / 体裁の密度
 * @returns Extra wrapper classes; empty for `document` / 追加クラス（document は空）
 */
export function densityClass(density: MarkdownDensity): string {
  return density === 'chat' ? CHAT_DENSITY_CLASS : '';
}
