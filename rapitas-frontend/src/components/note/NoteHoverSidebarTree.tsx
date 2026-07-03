/**
 * NoteHoverSidebarTree
 *
 * Renders NoteHoverSidebar's Category → Theme → Task → Notes hierarchy
 * (plus the standalone "other" group and the empty state). Extracted from
 * the sidebar component to keep it under the size limit; markup and
 * behavior are unchanged.
 */
'use client';
import { type useTranslations } from 'next-intl';
import { ChevronRight, FileText, Folders, SwatchBook } from 'lucide-react';
import type { Note } from '@/stores/note-store';
import { getIconComponent } from '@/components/category/icon-data';
import type { NoteTree as NoteTreeData } from './note-tree-utils';
import NoteHoverSidebarNoteItem from './NoteHoverSidebarNoteItem';

export interface NoteHoverSidebarTreeProps {
  tree: NoteTreeData;
  isEmpty: boolean;
  searchQuery: string;
  selectedTagsCount: number;
  expandedCategories: Set<string>;
  expandedThemes: Set<string>;
  expandedTasks: Set<string>;
  toggleCategory: (key: string) => void;
  toggleTheme: (key: string) => void;
  toggleTask: (key: string) => void;
  categoryIconMap: Map<string, string | null | undefined>;
  themeIconMap: Map<string, string | null | undefined>;
  currentNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteRequest: (note: Note) => void;
  formatDate: (date: Date) => string;
  /** `useTranslations('notes')` from the parent — kept as a prop to avoid a duplicate hook call. */
  t: ReturnType<typeof useTranslations<'notes'>>;
  /** `useTranslations('common')` from the parent — kept as a prop to avoid a duplicate hook call. */
  tc: ReturnType<typeof useTranslations<'common'>>;
}

/** Category → Theme → Task → Notes tree (plus standalone group and empty state). */
export default function NoteHoverSidebarTree({
  tree,
  isEmpty,
  searchQuery,
  selectedTagsCount,
  expandedCategories,
  expandedThemes,
  expandedTasks,
  toggleCategory,
  toggleTheme,
  toggleTask,
  categoryIconMap,
  themeIconMap,
  currentNoteId,
  onSelectNote,
  onDeleteRequest,
  formatDate,
  t,
  tc,
}: NoteHoverSidebarTreeProps) {
  const hasLinked = tree.categories.length > 0 || tree.themeGroups.length > 0;
  const hasSolo = tree.standalone.length > 0;

  const renderNote = (note: Note) => (
    <NoteHoverSidebarNoteItem
      key={note.id}
      note={note}
      isActive={currentNoteId === note.id}
      onSelect={() => onSelectNote(note.id)}
      onDeleteRequest={() => onDeleteRequest(note)}
      formatDate={formatDate}
      t={t}
    />
  );

  if (isEmpty) {
    return (
      <div className="py-6 text-center">
        <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {searchQuery || selectedTagsCount > 0
            ? t('hoverSidebar.noSearchResults')
            : t('common.noNotes')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Linked notes hierarchy */}
      {tree.categories.map((cat) => {
        const catExp = expandedCategories.has(cat.category);
        const CatIcon = getIconComponent(categoryIconMap.get(cat.category) ?? '') ?? Folders;
        return (
          <div key={cat.category}>
            <button
              onClick={() => toggleCategory(cat.category)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
            >
              <ChevronRight
                className={`w-4 h-4 shrink-0 text-zinc-400 transition-transform ${catExp ? 'rotate-90' : ''}`}
              />
              <CatIcon className="w-4 h-4 shrink-0 text-indigo-400" />
              <span className="truncate">{cat.category}</span>
            </button>

            {catExp &&
              cat.themes.map((th) => {
                const thKey = `${cat.category}|||${th.theme}`;
                const thExp = expandedThemes.has(thKey);
                const ThIcon = getIconComponent(themeIconMap.get(th.theme) ?? '') ?? SwatchBook;
                return (
                  <div key={th.theme} className="ml-4">
                    <button
                      onClick={() => toggleTheme(thKey)}
                      className="w-full flex items-center gap-2 px-2 py-1 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                    >
                      <ChevronRight
                        className={`w-3.5 h-3.5 shrink-0 text-zinc-400 transition-transform ${thExp ? 'rotate-90' : ''}`}
                      />
                      <ThIcon className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                      <span className="truncate">{th.theme}</span>
                    </button>

                    {thExp &&
                      th.tasks.map((tk) => {
                        const tkKey = `${thKey}|||${tk.taskId}`;
                        const tkExp = expandedTasks.has(tkKey);
                        return (
                          <div key={tk.taskId} className="ml-4">
                            <button
                              onClick={() => toggleTask(tkKey)}
                              className="w-full flex items-center gap-2 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                            >
                              <ChevronRight
                                className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${tkExp ? 'rotate-90' : ''}`}
                              />
                              <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">
                                {tk.taskLabel}
                              </span>
                            </button>
                            {tkExp && (
                              <div className="ml-4 space-y-0.5">{tk.notes.map(renderNote)}</div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}

      {/* 2-level: Theme → Task → Notes (no category) */}
      {tree.themeGroups.map((tg) => {
        const themeKey = `theme:${tg.theme}`;
        const thExp = expandedThemes.has(themeKey);
        const TgIcon = getIconComponent(themeIconMap.get(tg.theme) ?? '') ?? SwatchBook;
        return (
          <div key={themeKey}>
            <button
              onClick={() => toggleTheme(themeKey)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
            >
              <ChevronRight
                className={`w-4 h-4 shrink-0 text-zinc-400 transition-transform ${thExp ? 'rotate-90' : ''}`}
              />
              <TgIcon className="w-4 h-4 shrink-0 text-purple-400" />
              <span className="truncate">{tg.theme}</span>
            </button>

            {thExp &&
              tg.tasks.map((tk) => {
                const tkKey = `${themeKey}|||${tk.taskId}`;
                const tkExp = expandedTasks.has(tkKey);
                return (
                  <div key={tk.taskId} className="ml-4">
                    <button
                      onClick={() => toggleTask(tkKey)}
                      className="w-full flex items-center gap-2 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                    >
                      <ChevronRight
                        className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${tkExp ? 'rotate-90' : ''}`}
                      />
                      <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">
                        {tk.taskLabel}
                      </span>
                    </button>
                    {tkExp && <div className="ml-4 space-y-0.5">{tk.notes.map(renderNote)}</div>}
                  </div>
                );
              })}
          </div>
        );
      })}

      {/* Standalone notes */}
      {hasSolo && (
        <div>
          {hasLinked && (
            <div className="flex items-center gap-2 px-2 pt-2 pb-1">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
              <span className="text-[10px] text-zinc-500 shrink-0">{tc('other')}</span>
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            </div>
          )}
          <div className="space-y-0.5">{tree.standalone.map(renderNote)}</div>
        </div>
      )}
    </div>
  );
}
