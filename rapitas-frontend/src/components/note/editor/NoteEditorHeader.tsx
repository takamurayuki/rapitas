'use client';
// NoteEditorHeader
import { useTranslations } from 'next-intl';
import { Save, Trash2 } from 'lucide-react';
import { type Note, type DocType, DOC_TYPES } from '@/stores/note-store';

const DOC_TYPE_COLORS: Record<DocType, string> = {
  要件定義: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  設計書: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  議事録: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  手順書: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  仕様書: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  メモ: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

/** Maps each raw DocType value to its `docTypes.*` i18n message key. */
const DOC_TYPE_LABEL_KEYS: Record<DocType, string> = {
  要件定義: 'requirements',
  設計書: 'design',
  議事録: 'minutes',
  手順書: 'procedure',
  仕様書: 'specification',
  メモ: 'memo',
};

interface NoteEditorHeaderProps {
  note: Note;
  draftTitle: string;
  isDirty: boolean;
  titleRef?: React.RefObject<HTMLInputElement | null>;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTitlePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onDelete: () => void;
  /** Called when the user changes the document type / 種別変更コールバック */
  onSetDocType: (docType: DocType | undefined) => void;
}

/**
 * Top action bar for the note editor with title input, doc-type selector, and save/delete buttons.
 *
 * @param props - Title state, save handler, delete handler, and doc-type callback.
 */
export default function NoteEditorHeader({
  note,
  draftTitle,
  isDirty,
  titleRef,
  onTitleChange,
  onTitlePaste,
  onSave,
  onDelete,
  onSetDocType,
}: NoteEditorHeaderProps) {
  const t = useTranslations('notes');
  const tc = useTranslations('common');
  return (
    <div className="px-4 pt-3 pb-2">
      {/* Title row */}
      <div className="flex items-center gap-3">
        <input
          ref={titleRef}
          type="text"
          value={draftTitle}
          onChange={onTitleChange}
          onPaste={onTitlePaste}
          className="flex-1 text-xl font-bold bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100"
          placeholder={t('editorHeader.titlePlaceholder')}
          style={{ fontStyle: 'normal', textDecoration: 'none', fontWeight: 700 }}
        />
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg transition-colors shrink-0 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          title={t('editorHeader.deleteNoteTitle')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={onSave}
          disabled={!isDirty}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
            isDirty
              ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-default'
          }`}
          title={t('editorHeader.saveTitle')}
        >
          <Save className="w-3.5 h-3.5" />
          {isDirty ? tc('save') : t('editorHeader.saved')}
        </button>
      </div>

      {/* Doc-type selector row */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <button
          onClick={() => onSetDocType(undefined)}
          className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
            !note.docType
              ? 'border-zinc-400 dark:border-zinc-500 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-medium'
              : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-zinc-300'
          }`}
        >
          {t('editorHeader.noType')}
        </button>
        {DOC_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onSetDocType(note.docType === type ? undefined : type)}
            className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
              note.docType === type
                ? `${DOC_TYPE_COLORS[type]} border-transparent font-medium`
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            {t(`docTypes.${DOC_TYPE_LABEL_KEYS[type]}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
