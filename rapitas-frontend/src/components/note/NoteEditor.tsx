/**
 * NoteEditor
 *
 * Orchestrates the rich-text note editing surface.
 * Delegates state management to useNoteEditor and rendering to sub-components:
 * NoteEditorHeader, EditorToolbar, and NoteEditorFooter.
 */
'use client';
import { type Note } from '@/stores/noteStore';
import { useNoteEditor } from './editor/useNoteEditor';
import NoteEditorHeader from './editor/NoteEditorHeader';
import NoteEditorFooter from './editor/NoteEditorFooter';
import EditorToolbar from './editor/EditorToolbar';

interface NoteEditorProps {
  note: Note;
}

export default function NoteEditor({ note }: NoteEditorProps) {
  const editor = useNoteEditor(note);

  return (
    <div className="flex flex-col h-full">
      <NoteEditorHeader
        note={note}
        draftTitle={editor.draftTitle}
        isDirty={editor.isDirty}
        locale={editor.locale}
        isGeneratingFlashcards={editor.isGeneratingFlashcards}
        flashcardResult={editor.flashcardResult}
        onTitleChange={editor.handleTitleChange}
        onTitlePaste={editor.handleTitlePaste}
        onSave={editor.handleSave}
        onTogglePin={() =>
          editor.updateNote(note.id, { isPinned: !note.isPinned })
        }
        onGenerateFlashcards={editor.handleGenerateFlashcards}
      />

      <EditorToolbar
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
        onOpenLinkInput={editor.openLinkInput}
        onOpenCodeInput={editor.openCodeInput}
        onResetTextColor={editor.handleResetTextColor}
        closeAllPopups={editor.closeAllPopups}
        onTextColorButtonClick={editor.handleTextColorButtonClick}
      />

      {/* Editor body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div
          ref={editor.contentRef}
          contentEditable
          suppressContentEditableWarning
          className="p-4 min-h-full outline-none prose prose-zinc dark:prose-invert max-w-none note-editor"
          onInput={editor.onEditorInput}
          onKeyDown={editor.onEditorKeyDown}
          style={{ lineHeight: '1.8', fontSize: '16px' }}
        />
      </div>

      <NoteEditorFooter
        createdAt={note.createdAt}
        updatedAt={note.updatedAt}
        dateLocale={editor.dateLocale}
      />
    </div>
  );
}
