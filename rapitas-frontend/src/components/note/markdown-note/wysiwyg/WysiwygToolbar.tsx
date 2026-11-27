'use client';
/**
 * WysiwygToolbar
 *
 * The note toolbar: marks (bold, italic, underline, strike), blocks
 * (paragraph, headings, lists, checklist, quote), inserts (code block with a
 * language, Mermaid diagram from a template, table, link) and the colour,
 * highlight and size menus. Each button runs one wysiwyg-commands function
 * on the surface and reports the edit.
 * Not responsible for the surface itself; see WysiwygNoteSurface.
 */
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  ListOrdered,
  ListTree,
  Pilcrow,
  Quote,
  Shapes,
  SquareCheckBig,
  SquareCode,
  Strikethrough,
  Table,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import { TableSizePicker } from '../../editor/toolbar/TableSizePicker';
import { DIAGRAM_TEMPLATES } from '../../editor/diagram-templates';
import { programmingLanguages } from '../../editor/constants';
import {
  applyBlock,
  applyInlineMark,
  insertCodeBlock,
  insertDiagram,
  insertLink,
  insertTable,
  restoreSelection,
  saveSelection,
  toggleChecklist,
  type BlockCommand,
  type InlineMark,
} from './wysiwyg-commands';
import WysiwygStyleMenus, { ToolbarPopover } from './WysiwygStyleMenus';

interface WysiwygToolbarProps {
  /** The surface the commands act on / 対象の編集面 */
  surfaceRef: RefObject<HTMLDivElement | null>;
  /** Called after a command changed the surface / 命令で編集面が変わったとき */
  onCommand: () => void;
}

const BUTTON =
  'inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

/**
 * A toolbar button that keeps the surface's selection (no focus steal on mousedown).
 *
 * @param props - Icon, label and action / アイコン・ラベル・動作
 */
export function ToolbarButton({
  icon: Icon,
  label,
  onRun,
}: {
  icon: LucideIcon;
  label: string;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={BUTTON}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Separator() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;
}

/**
 * The note toolbar.
 *
 * @param props - The surface ref and the edit callback / 編集面と変更通知
 */
export default function WysiwygToolbar({ surfaceRef, onCommand }: WysiwygToolbarProps) {
  const t = useTranslations('notes.markdownNote.toolbar');
  const td = useTranslations('notes.diagramEdit.templates');
  const [url, setUrl] = useState('');
  // The URL field takes the focus; the surface's selection is kept for it.
  const savedRange = useRef<Range | null>(null);
  const run = (command: (root: HTMLDivElement) => boolean) => () => {
    const root = surfaceRef.current;
    if (root && command(root)) onCommand();
  };
  const mark = (m: InlineMark) => run((root) => applyInlineMark(root, m));
  const block = (b: BlockCommand) => run((root) => applyBlock(root, b));
  const menuItem = (key: string, label: ReactNode, onPick: () => void) => (
    <button
      key={key}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {label}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-0.5 px-3 py-1 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
    >
      <ToolbarButton icon={Bold} label={t('bold')} onRun={mark('bold')} />
      <ToolbarButton icon={Italic} label={t('italic')} onRun={mark('italic')} />
      <ToolbarButton icon={Underline} label={t('underline')} onRun={mark('underline')} />
      <ToolbarButton icon={Strikethrough} label={t('strike')} onRun={mark('strikeThrough')} />
      <Separator />
      <ToolbarButton icon={Pilcrow} label={t('paragraph')} onRun={block('p')} />
      <ToolbarButton icon={Heading1} label={t('h1')} onRun={block('h1')} />
      <ToolbarButton icon={Heading2} label={t('h2')} onRun={block('h2')} />
      <ToolbarButton icon={Heading3} label={t('h3')} onRun={block('h3')} />
      <Separator />
      <ToolbarButton icon={ListTree} label={t('bulletList')} onRun={block('ul')} />
      <ToolbarButton icon={ListOrdered} label={t('numberedList')} onRun={block('ol')} />
      <ToolbarButton icon={SquareCheckBig} label={t('checklist')} onRun={run(toggleChecklist)} />
      <ToolbarButton icon={Quote} label={t('quote')} onRun={block('blockquote')} />
      <Separator />
      <ToolbarPopover icon={SquareCode} label={t('codeBlock')}>
        {(close) => [
          menuItem('none', t('noLanguage'), () => {
            run((root) => insertCodeBlock(root, ''))();
            close();
          }),
          ...programmingLanguages.map((lang) =>
            menuItem(lang.value, lang.label, () => {
              run((root) => insertCodeBlock(root, lang.value))();
              close();
            }),
          ),
        ]}
      </ToolbarPopover>
      <ToolbarPopover icon={Shapes} label={t('diagram')}>
        {(close) =>
          DIAGRAM_TEMPLATES.map((tpl) =>
            menuItem(tpl.labelKey, td(tpl.labelKey), () => {
              run((root) => insertDiagram(root, tpl.source))();
              close();
            }),
          )
        }
      </ToolbarPopover>
      <ToolbarPopover icon={Table} label={t('table')}>
        {(close) => (
          <TableSizePicker
            onPick={(shape) => {
              run((root) => insertTable(root, shape, (n) => t('columnHeading', { n })))();
              close();
            }}
          />
        )}
      </ToolbarPopover>
      <ToolbarPopover
        icon={Link}
        label={t('link')}
        onOpen={() => {
          savedRange.current = surfaceRef.current ? saveSelection(surfaceRef.current) : null;
        }}
      >
        {(close) => (
          <form
            className="flex items-center gap-1 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              restoreSelection(savedRange.current);
              run((root) => insertLink(root, url))();
              setUrl('');
              close();
            }}
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('linkPlaceholder')}
              aria-label={t('link')}
              className="w-56 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="submit"
              className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {t('insert')}
            </button>
          </form>
        )}
      </ToolbarPopover>
      <Separator />
      <WysiwygStyleMenus surfaceRef={surfaceRef} onCommand={onCommand} />
    </div>
  );
}
