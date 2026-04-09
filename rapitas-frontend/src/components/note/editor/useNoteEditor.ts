/**
 * useNoteEditor
 *
 * Composition hook for the NoteEditor. Combines popup/format state with
 * insertion operations (useEditorInsertion) and flashcard generation
 * (useFlashcardGenerator). Exports a single NoteEditorState object consumed
 * by NoteEditor and its sub-components.
 */
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { type Note, useNoteStore } from '@/stores/note-store';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

import { highlightStyles } from './constants';
import {
  applyFormat as applyFormatUtil,
  applyHighlight as applyHighlightUtil,
  applyBorderLine as applyBorderLineUtil,
  applyFontSize as applyFontSizeUtil,
  applyFont as applyFontUtil,
  detectCurrentFormat,
  isInTitleInput,
} from './formatting';
import { normalizeLinkCards } from './link-card';
import { handleEditorKeyDown } from './editor-keydown';
import {
  handleEditorInput as handleEditorInputUtil,
  handleDeleteColorPersistence,
} from './color-persistence';
import { applyTextColor as applyTextColorUtil } from './text-color';
import {
  useFlashcardGenerator,
  type FlashcardResult,
} from './useFlashcardGenerator';
import { useEditorInsertion } from './useEditorInsertion';
import { useNotePopups } from './useNotePopups';

export type { FlashcardResult };

/**
 * All values and handlers returned by useNoteEditor.
 */
export interface NoteEditorState {
  // Store
  updateNote: ReturnType<typeof useNoteStore>['updateNote'];
  locale: string;
  dateLocale: string;

  // Refs
  contentRef: React.RefObject<HTMLDivElement>;

  // Title state
  draftTitle: string;
  isDirty: boolean;
  handleTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTitlePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  handleSave: () => void;

  // Popup visibility
  showColorPicker: boolean;
  showBorderPicker: boolean;
  showLinkInput: boolean;
  showCodeInput: boolean;
  showFontSizePicker: boolean;
  showFontPicker: boolean;
  showTextColorPicker: boolean;
  setShowColorPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBorderPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowLinkInput: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCodeInput: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFontSizePicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFontPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTextColorPicker: React.Dispatch<React.SetStateAction<boolean>>;
  closeAllPopups: () => void;

  // Link
  linkUrl: string;
  isLinkLoading: boolean;
  setLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  openLinkInput: () => void;
  insertLink: () => Promise<void>;

  // Code
  codeLanguage: string;
  setCodeLanguage: React.Dispatch<React.SetStateAction<string>>;
  openCodeInput: () => void;
  insertCodeBlock: () => void;

  // Highlight / border / font
  highlightStyleIndex: number;
  setHighlightStyleIndex: React.Dispatch<React.SetStateAction<number>>;
  currentFontSize: string;
  currentFont: string;
  currentTextColor: string;
  setCurrentFont: React.Dispatch<React.SetStateAction<string>>;
  setCurrentFontSize: React.Dispatch<React.SetStateAction<string>>;
  setCurrentTextColor: React.Dispatch<React.SetStateAction<string>>;
  onApplyFormat: (command: string, value?: string) => void;
  onApplyHighlight: (color: string) => void;
  onApplyBorderLine: (color: string) => void;
  onApplyFontSize: (size: string) => void;
  onApplyFont: (font: string) => void;
  applyTextColor: (color: string) => void;
  handleTextColorButtonClick: () => void;
  handleResetTextColor: () => void;

  // Table
  insertTable: () => void;

  // Editor events
  onEditorInput: (e: React.FormEvent<HTMLDivElement>) => void;
  onEditorKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;

  // Flashcards
  isGeneratingFlashcards: boolean;
  flashcardResult: FlashcardResult | null;
  handleGenerateFlashcards: () => Promise<void>;
}

/**
 * Composition hook providing all state, logic, and handlers for the NoteEditor.
 *
 * @param note - The note currently being edited.
 * @returns A flat NoteEditorState object consumed by NoteEditor's render tree.
 */
export function useNoteEditor(note: Note): NoteEditorState {
  const { updateNote } = useNoteStore();
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const contentRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const activeColorSpanRef = useRef<HTMLSpanElement | null>(null);
  const selectedTextColorRef = useRef<string | null>(null);

  const [draftTitle, setDraftTitle] = useState(note.title);
  const [isDirty, setIsDirty] = useState(false);

  // Popup visibility state + close-all/close-others helpers + outside-click effect
  const popups = useNotePopups();
  const {
    showTextColorPicker,
    setShowColorPicker,
    setShowBorderPicker,
    setShowLinkInput,
    setShowCodeInput,
    setShowFontSizePicker,
    setShowFontPicker,
    setShowTextColorPicker,
    closeOtherPopups,
  } = popups;

  // Insertion field state
  const [linkUrl, setLinkUrl] = useState('');
  const [isLinkLoading, setIsLinkLoading] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const [highlightStyleIndex, setHighlightStyleIndex] = useState(1);

  // Font / color display state
  const [currentFontSize, setCurrentFontSize] = useState('16');
  const [currentFont, setCurrentFont] = useState('inherit');
  const [currentTextColor, setCurrentTextColor] = useState('#000000');

  const handleContentChange = useCallback(() => {
    setIsDirty(true);
  }, []);

  // Reset editor content when note changes
  useEffect(() => {
    setDraftTitle(note.title);
    setIsDirty(false);
    if (contentRef.current) {
      contentRef.current.innerHTML = DOMPurify.sanitize(note.content);
      normalizeLinkCards(contentRef.current, handleContentChange);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Ctrl+S save shortcut
  const handleSave = useCallback(() => {
    if (!isDirty) return;
    const content = contentRef.current?.innerHTML ?? note.content;
    updateNote(note.id, { title: draftTitle, content });
    setIsDirty(false);
  }, [isDirty, draftTitle, note.id, note.content, updateNote]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  // Detect formatting at current cursor position
  const handleDetectFormat = useCallback(() => {
    const format = detectCurrentFormat();
    if (format) {
      setCurrentFontSize(format.fontSize);
      setCurrentFont(format.fontFamily);
      setCurrentTextColor(format.textColor);
    }
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (contentRef.current?.contains(document.activeElement)) {
        handleDetectFormat();
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () =>
      document.removeEventListener('selectionchange', handleSelectionChange);
  }, [handleDetectFormat]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftTitle(e.target.value);
    setIsDirty(true);
  };

  const handleTitlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const target = e.target as HTMLInputElement;
    const start = target.selectionStart || 0;
    const end = target.selectionEnd || 0;
    const newValue =
      target.value.substring(0, start) + text + target.value.substring(end);
    setDraftTitle(newValue);
    setIsDirty(true);
    setTimeout(() => {
      target.selectionStart = target.selectionEnd = start + text.length;
    }, 0);
  };

  // Format / style application callbacks
  const onApplyFormat = useCallback(
    (command: string, value?: string) => {
      applyFormatUtil(contentRef.current, command, value);
      handleContentChange();
    },
    [handleContentChange],
  );

  const onApplyHighlight = useCallback(
    (color: string) => {
      const applied = applyHighlightUtil(
        contentRef.current,
        color,
        highlightStyles[highlightStyleIndex].top,
      );
      if (applied) handleContentChange();
      setShowColorPicker(false);
    },
    [highlightStyleIndex, handleContentChange],
  );

  const onApplyBorderLine = useCallback(
    (color: string) => {
      const applied = applyBorderLineUtil(contentRef.current, color);
      if (applied) handleContentChange();
      setShowBorderPicker(false);
    },
    [handleContentChange],
  );

  const onApplyFontSize = useCallback(
    (size: string) => {
      const applied = applyFontSizeUtil(contentRef.current, size);
      if (applied) handleContentChange();
      setShowFontSizePicker(false);
    },
    [handleContentChange],
  );

  const onApplyFont = useCallback(
    (font: string) => {
      const applied = applyFontUtil(contentRef.current, font);
      if (applied) handleContentChange();
      setShowFontPicker(false);
    },
    [handleContentChange],
  );

  const editorRefs = { contentRef, activeColorSpanRef, selectedTextColorRef };

  const applyTextColor = useCallback(
    (color: string) => {
      applyTextColorUtil(color, editorRefs, {
        setCurrentTextColor,
        setShowTextColorPicker,
        handleContentChange,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleContentChange],
  );

  const handleTextColorButtonClick = useCallback(() => {
    const wasOpen = showTextColorPicker;
    setShowTextColorPicker(!showTextColorPicker);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowLinkInput(false);
    setShowCodeInput(false);

    if (!wasOpen && contentRef.current) {
      if (isInTitleInput()) return;
      if (!contentRef.current.contains(document.activeElement)) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
        }
        contentRef.current.focus();
        if (savedSelectionRef.current) {
          requestAnimationFrame(() => {
            const newSel = window.getSelection();
            if (newSel) {
              newSel.removeAllRanges();
              newSel.addRange(savedSelectionRef.current!);
            }
          });
        }
      }
    }
  }, [showTextColorPicker]);

  const handleResetTextColor = useCallback(() => {
    selectedTextColorRef.current = null;
    const defaultColor = document.documentElement.classList.contains('dark')
      ? '#E4E4E7'
      : '#000000';
    setCurrentTextColor(defaultColor);
    if (activeColorSpanRef.current) {
      const oldSpan = activeColorSpanRef.current;
      if (oldSpan.textContent === '\u200B' || oldSpan.textContent === '') {
        oldSpan.remove();
      }
      activeColorSpanRef.current = null;
    }
    selectedTextColorRef.current = null;
    setShowTextColorPicker(false);
  }, []);

  // DOM insertion operations delegated to useEditorInsertion
  const insertion = useEditorInsertion(
    { contentRef, savedSelectionRef },
    { setIsLinkLoading, setShowLinkInput, setLinkUrl, setShowCodeInput },
    linkUrl,
    codeLanguage,
    handleContentChange,
    closeOtherPopups,
  );

  // Flashcard generation delegated to useFlashcardGenerator
  const flashcards = useFlashcardGenerator(
    () => contentRef.current?.innerHTML,
    note.title,
    locale,
  );

  const onEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    handleEditorInputUtil(e, editorRefs, handleContentChange);
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    handleEditorKeyDown(e, editorRefs, handleContentChange);
    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      selectedTextColorRef.current
    ) {
      const selection = window.getSelection();
      if (
        selection &&
        selection.rangeCount > 0 &&
        selection.getRangeAt(0).collapsed
      ) {
        handleDeleteColorPersistence(editorRefs);
      }
    }
  };

  return {
    updateNote,
    locale,
    dateLocale,
    contentRef,
    draftTitle,
    isDirty,
    handleTitleChange,
    handleTitlePaste,
    handleSave,
    showColorPicker: popups.showColorPicker,
    showBorderPicker: popups.showBorderPicker,
    showLinkInput: popups.showLinkInput,
    showCodeInput: popups.showCodeInput,
    showFontSizePicker: popups.showFontSizePicker,
    showFontPicker: popups.showFontPicker,
    showTextColorPicker,
    setShowColorPicker,
    setShowBorderPicker,
    setShowLinkInput,
    setShowCodeInput,
    setShowFontSizePicker,
    setShowFontPicker,
    setShowTextColorPicker,
    closeAllPopups: popups.closeAllPopups,
    linkUrl,
    isLinkLoading,
    setLinkUrl,
    openLinkInput: insertion.openLinkInput,
    insertLink: insertion.insertLink,
    codeLanguage,
    setCodeLanguage,
    openCodeInput: insertion.openCodeInput,
    insertCodeBlock: insertion.insertCodeBlock,
    highlightStyleIndex,
    setHighlightStyleIndex,
    currentFontSize,
    currentFont,
    currentTextColor,
    setCurrentFont,
    setCurrentFontSize,
    setCurrentTextColor,
    onApplyFormat,
    onApplyHighlight,
    onApplyBorderLine,
    onApplyFontSize,
    onApplyFont,
    applyTextColor,
    handleTextColorButtonClick,
    handleResetTextColor,
    insertTable: insertion.insertTable,
    onEditorInput,
    onEditorKeyDown,
    ...flashcards,
  };
}
