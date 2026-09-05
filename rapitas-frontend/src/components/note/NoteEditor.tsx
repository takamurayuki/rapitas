'use client';
// NoteEditor
import { useState, useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { type Note, useNoteStore } from '@/stores/note-store';
import { useNoteEditor } from './editor/useNoteEditor';
import NoteEditorHeader from './editor/NoteEditorHeader';
import NoteEditorFooter from './editor/NoteEditorFooter';
import EditorToolbar from './editor/EditorToolbar';
import DiagramBlockEdit from './editor/DiagramBlockEdit';
import { getDiagramSource, setDiagramSource } from './editor/diagram-block';

interface DiagramEditState {
  el: HTMLElement;
  source: string;
}

interface NoteEditorProps {
  note: Note;
  /** Optional extra content rendered below the toolbar (e.g. split-view panels). */
  children?: ReactNode;
}

export default function NoteEditor({ note, children }: NoteEditorProps) {
  const t = useTranslations('notes');
  const editor = useNoteEditor(note);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);
  const [editingDiagram, setEditingDiagram] = useState<DiagramEditState | null>(null);

  const handleEditorClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;

      // Delete button takes priority — use class selector; DOMPurify strips data-* on load
      if (target.closest('.diagram-delete-btn')) {
        const block = target.closest('.diagram-block') as HTMLElement | null;
        if (block) {
          block.remove();
          editor.markDirty();
        }
        return;
      }

      // Click anywhere else on the block opens the editor
      const block = target.closest('.diagram-block') as HTMLElement | null;
      if (block) {
        setEditingDiagram({ el: block, source: getDiagramSource(block) });
      }
    },
    [editor],
  );

  const handleDiagramSave = useCallback(
    async (newSource: string) => {
      if (!editingDiagram) return;
      setDiagramSource(editingDiagram.el, newSource);
      await editor.renderDiagramBlock(editingDiagram.el);
      editor.markDirty();
      setEditingDiagram(null);
    },
    [editingDiagram, editor],
  );

  return (
    <div className="flex flex-col h-full relative">
      <NoteEditorHeader
        note={note}
        draftTitle={editor.draftTitle}
        isDirty={editor.isDirty}
        titleRef={editor.titleRef}
        onTitleChange={editor.handleTitleChange}
        onTitlePaste={editor.handleTitlePaste}
        onSave={editor.handleSave}
        onDelete={() => {
          deleteNote(note.id);
          setCurrentNote(null);
        }}
        onSetDocType={(docType) => updateNote(note.id, { docType })}
      />

      <EditorToolbar
        currentBlockType={editor.currentBlockType}
        showBlockPicker={editor.showBlockPicker}
        setShowBlockPicker={editor.setShowBlockPicker}
        onApplyBlockType={editor.onApplyBlockType}
        currentFont={editor.currentFont}
        currentFontSize={editor.currentFontSize}
        currentTextColor={editor.currentTextColor}
        highlightStyleIndex={editor.highlightStyleIndex}
        showFontPicker={editor.showFontPicker}
        showFontSizePicker={editor.showFontSizePicker}
        showTextColorPicker={editor.showTextColorPicker}
        showColorPicker={editor.showColorPicker}
        showBorderPicker={editor.showBorderPicker}
        showLinkInput={editor.showLinkInput}
        showCodeInput={editor.showCodeInput}
        linkUrl={editor.linkUrl}
        isLinkLoading={editor.isLinkLoading}
        codeLanguage={editor.codeLanguage}
        setCurrentFont={editor.setCurrentFont}
        setCurrentFontSize={editor.setCurrentFontSize}
        setCurrentTextColor={editor.setCurrentTextColor}
        setHighlightStyleIndex={editor.setHighlightStyleIndex}
        setShowFontPicker={editor.setShowFontPicker}
        setShowFontSizePicker={editor.setShowFontSizePicker}
        setShowTextColorPicker={editor.setShowTextColorPicker}
        setShowColorPicker={editor.setShowColorPicker}
        setShowBorderPicker={editor.setShowBorderPicker}
        setShowLinkInput={editor.setShowLinkInput}
        setShowCodeInput={editor.setShowCodeInput}
        setLinkUrl={editor.setLinkUrl}
        setCodeLanguage={editor.setCodeLanguage}
        onApplyFormat={editor.onApplyFormat}
        onApplyHighlight={editor.onApplyHighlight}
        onApplyBorderLine={editor.onApplyBorderLine}
        onApplyFontSize={editor.onApplyFontSize}
        onApplyFont={editor.onApplyFont}
        onApplyTextColor={editor.applyTextColor}
        onInsertTable={editor.insertTable}
        onInsertLink={editor.insertLink}
        onInsertCodeBlock={editor.insertCodeBlock}
        onInsertDiagram={editor.insertDiagramBlock}
        onOpenLinkInput={editor.openLinkInput}
        onOpenCodeInput={editor.openCodeInput}
        onResetTextColor={editor.handleResetTextColor}
        closeAllPopups={editor.closeAllPopups}
        onTextColorButtonClick={editor.handleTextColorButtonClick}
      />

      {children ?? (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div
            ref={editor.contentRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={t('editorContentLabel')}
            tabIndex={0}
            className="p-4 min-h-full outline-none prose prose-zinc dark:prose-invert max-w-none note-editor"
            onInput={editor.onEditorInput}
            onKeyDown={editor.onEditorKeyDown}
            onCompositionStart={editor.onEditorCompositionStart}
            onCompositionEnd={editor.onEditorCompositionEnd}
            onClick={handleEditorClick}
            style={{ lineHeight: '1.8', fontSize: '16px' }}
          />
        </div>
      )}

      <NoteEditorFooter createdAt={note.createdAt} updatedAt={note.updatedAt} />

      {/* Diagram edit overlay — covers the entire editor when a block is clicked */}
      {editingDiagram && (
        <DiagramBlockEdit
          source={editingDiagram.source}
          onSave={handleDiagramSave}
          onCancel={() => setEditingDiagram(null)}
        />
      )}
    </div>
  );
}
