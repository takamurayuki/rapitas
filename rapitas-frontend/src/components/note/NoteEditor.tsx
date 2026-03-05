'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Save, Pin, Calendar } from 'lucide-react';
import { Note, useNoteStore } from '@/stores/noteStore';
import { API_BASE_URL } from '@/utils/api';

import { highlightStyles } from './editor/constants';
import {
  applyFormat as applyFormatUtil,
  applyHighlight as applyHighlightUtil,
  applyBorderLine as applyBorderLineUtil,
  applyFontSize as applyFontSizeUtil,
  applyFont as applyFontUtil,
  detectCurrentFormat,
  isInTitleInput,
} from './editor/formatting';
import { createCodeBlockNode } from './editor/code-block';
import { createLinkNode, normalizeLinkCards } from './editor/link-card';
import { createTableNode } from './editor/table';
import { handleEditorKeyDown } from './editor/editor-keydown';
import {
  handleEditorInput as handleEditorInputUtil,
  handleDeleteColorPersistence,
} from './editor/color-persistence';
import { applyTextColor as applyTextColorUtil } from './editor/text-color';
import EditorToolbar from './editor/EditorToolbar';

interface NoteEditorProps {
  note: Note;
}

export default function NoteEditor({ note }: NoteEditorProps) {
  const { updateNote } = useNoteStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBorderPicker, setShowBorderPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [isLinkLoading, setIsLinkLoading] = useState(false);
  const [highlightStyleIndex, setHighlightStyleIndex] = useState(1);
  const [isDirty, setIsDirty] = useState(false);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const savedSelectionRef = useRef<Range | null>(null);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [currentFontSize, setCurrentFontSize] = useState('16');
  const [currentFont, setCurrentFont] = useState('inherit');
  const [currentTextColor, setCurrentTextColor] = useState('#000000');

  // 現在アクティブな色のspanを追跡
  const activeColorSpanRef = useRef<HTMLSpanElement | null>(null);
  // 現在選択されている文字色を保持（常に適用するため）
  const selectedTextColorRef = useRef<string | null>(null);

  // Bundled refs for extracted modules
  const editorRefs = {
    contentRef,
    activeColorSpanRef,
    selectedTextColorRef,
  };

  // ---- Helper: close all popups ----
  const closeAllPopups = useCallback(() => {
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowLinkInput(false);
    setShowCodeInput(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
  }, []);

  // ポップアップの外側をクリックした時に閉じる処理
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (
        !showColorPicker &&
        !showBorderPicker &&
        !showLinkInput &&
        !showCodeInput &&
        !showFontSizePicker &&
        !showFontPicker &&
        !showTextColorPicker
      ) {
        return;
      }

      const isInsidePopup = target.closest('.absolute.top-full') !== null;
      const isButton =
        target.closest(
          'button[title="ハイライト"], button[title="縦線"], button[title="リンク挿入"], button[title="コードブロック挿入"], button[title="文字サイズ"], button[title="フォント"], button[title="文字色"]',
        ) !== null;

      if (!isInsidePopup && !isButton) {
        closeAllPopups();
      }
    };

    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAllPopups();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [
    showColorPicker,
    showBorderPicker,
    showLinkInput,
    showCodeInput,
    showFontSizePicker,
    showFontPicker,
    showTextColorPicker,
    closeAllPopups,
  ]);

  // コンテンツ変更（ダーティフラグのみ）
  const handleContentChange = useCallback(() => {
    setIsDirty(true);
  }, []);

  // 現在の選択範囲のフォーマットを検出
  const handleDetectFormat = useCallback(() => {
    const format = detectCurrentFormat();
    if (format) {
      setCurrentFontSize(format.fontSize);
      setCurrentFont(format.fontFamily);
      setCurrentTextColor(format.textColor);
    }
  }, []);

  // ノート切り替え時・初回マウント時にコンテンツをセット
  useEffect(() => {
    setDraftTitle(note.title);
    setIsDirty(false);
    if (contentRef.current) {
      contentRef.current.innerHTML = note.content;
      normalizeLinkCards(contentRef.current, handleContentChange);
    }
  }, [note.id]);

  // タイトル変更
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftTitle(e.target.value);
    setIsDirty(true);
  };

  // タイトルペースト時にHTMLタグを除去
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

  // 手動保存
  const handleSave = useCallback(() => {
    if (!isDirty) return;
    const content = contentRef.current?.innerHTML ?? note.content;
    updateNote(note.id, { title: draftTitle, content });
    setIsDirty(false);
  }, [isDirty, draftTitle, note.id, note.content, updateNote]);

  // Ctrl+S で保存
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

  // 選択変更時にフォーマット検出
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

  // ---- Toolbar action callbacks ----

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

  // 文字色適用 -- delegates to extracted module
  const applyTextColor = useCallback(
    (color: string) => {
      applyTextColorUtil(color, editorRefs, {
        setCurrentTextColor,
        setShowTextColorPicker,
        handleContentChange,
      });
    },
    [handleContentChange],
  );

  // ---- Link / Code / Table insertion ----

  const openLinkInput = useCallback(() => {
    if (isInTitleInput()) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
    setShowLinkInput(true);
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowCodeInput(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
    setLinkUrl('');
  }, []);

  const openCodeInput = useCallback(() => {
    if (isInTitleInput()) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
    setShowCodeInput(true);
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowLinkInput(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
  }, []);

  const insertNodeAtCursor = useCallback((node: Node) => {
    const selection = window.getSelection();
    if (savedSelectionRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedSelectionRef.current);
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      const newRange = document.createRange();
      newRange.setStartAfter(node);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else if (contentRef.current) {
      contentRef.current.appendChild(node);
    }
  }, []);

  const insertLink = useCallback(async () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    setIsLinkLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/url-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const meta = await res.json();
      const linkNode = createLinkNode(url, meta.title || url, meta.favicon || '');
      insertNodeAtCursor(linkNode);
      handleContentChange();
    } catch {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url;
      insertNodeAtCursor(a);
      handleContentChange();
    } finally {
      setIsLinkLoading(false);
      setShowLinkInput(false);
      setLinkUrl('');
      savedSelectionRef.current = null;
    }
  }, [linkUrl, insertNodeAtCursor, handleContentChange]);

  const insertTable = useCallback(() => {
    if (isInTitleInput()) return;
    if (!contentRef.current?.contains(document.activeElement)) {
      contentRef.current?.focus();
    }
    const frag = createTableNode();
    const lastChild = frag.lastChild;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!contentRef.current?.contains(range.commonAncestorContainer)) return;
      range.deleteContents();
      range.insertNode(frag);
      if (lastChild) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastChild);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }
    handleContentChange();
  }, [handleContentChange]);

  const insertCodeBlock = useCallback(() => {
    const frag = createCodeBlockNode(codeLanguage);
    const lastChild = frag.lastChild;

    if (savedSelectionRef.current) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(savedSelectionRef.current);
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(frag);
        if (lastChild) {
          const newRange = document.createRange();
          newRange.setStartAfter(lastChild);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }

    // Wire up delete handlers
    if (contentRef.current) {
      const newBlocks = contentRef.current.querySelectorAll(
        '[data-needs-delete-handler="1"]',
      );
      newBlocks.forEach((block) => {
        const deleteButton = block.querySelector('[data-delete-handler="1"]');
        if (deleteButton) {
          (deleteButton as HTMLElement).onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            (block as HTMLElement).remove();
            handleContentChange();
          };
        }
        (block as HTMLElement).removeAttribute('data-needs-delete-handler');
      });
    }

    handleContentChange();
    setShowCodeInput(false);
    savedSelectionRef.current = null;
  }, [codeLanguage, handleContentChange]);

  // ---- Text color button / reset ----

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
      const activeElement = document.activeElement;
      if (isInTitleInput()) return;

      if (!contentRef.current.contains(activeElement)) {
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

  // ---- Editor event handlers (delegating to extracted modules) ----

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
      if (selection && selection.rangeCount > 0 && selection.getRangeAt(0).collapsed) {
        handleDeleteColorPersistence(editorRefs);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* タイトル + 保存 */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <input
          type="text"
          value={draftTitle}
          onChange={handleTitleChange}
          onPaste={handleTitlePaste}
          className="flex-1 text-xl font-bold bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100"
          placeholder="タイトルを入力..."
          style={{ fontStyle: 'normal', textDecoration: 'none', fontWeight: 700 }}
        />
        <button
          onClick={() => updateNote(note.id, { isPinned: !note.isPinned })}
          className={`p-1.5 rounded-lg transition-colors shrink-0 ${
            note.isPinned
              ? 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
              : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
          title={note.isPinned ? 'ピンを外す' : 'ピン留め'}
        >
          <Pin className="w-4 h-4" />
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
            isDirty
              ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-default'
          }`}
          title="保存（Ctrl+S）"
        >
          <Save className="w-3.5 h-3.5" />
          {isDirty ? '保存' : '保存済み'}
        </button>
      </div>

      {/* ツールバー */}
      <EditorToolbar
        currentFont={currentFont}
        currentFontSize={currentFontSize}
        currentTextColor={currentTextColor}
        highlightStyleIndex={highlightStyleIndex}
        showFontPicker={showFontPicker}
        showFontSizePicker={showFontSizePicker}
        showTextColorPicker={showTextColorPicker}
        showColorPicker={showColorPicker}
        showBorderPicker={showBorderPicker}
        showLinkInput={showLinkInput}
        showCodeInput={showCodeInput}
        linkUrl={linkUrl}
        isLinkLoading={isLinkLoading}
        codeLanguage={codeLanguage}
        setCurrentFont={setCurrentFont}
        setCurrentFontSize={setCurrentFontSize}
        setCurrentTextColor={setCurrentTextColor}
        setHighlightStyleIndex={setHighlightStyleIndex}
        setShowFontPicker={setShowFontPicker}
        setShowFontSizePicker={setShowFontSizePicker}
        setShowTextColorPicker={setShowTextColorPicker}
        setShowColorPicker={setShowColorPicker}
        setShowBorderPicker={setShowBorderPicker}
        setShowLinkInput={setShowLinkInput}
        setShowCodeInput={setShowCodeInput}
        setLinkUrl={setLinkUrl}
        setCodeLanguage={setCodeLanguage}
        onApplyFormat={onApplyFormat}
        onApplyHighlight={onApplyHighlight}
        onApplyBorderLine={onApplyBorderLine}
        onApplyFontSize={onApplyFontSize}
        onApplyFont={onApplyFont}
        onApplyTextColor={applyTextColor}
        onInsertTable={insertTable}
        onInsertLink={insertLink}
        onInsertCodeBlock={insertCodeBlock}
        onOpenLinkInput={openLinkInput}
        onOpenCodeInput={openCodeInput}
        onResetTextColor={handleResetTextColor}
        closeAllPopups={closeAllPopups}
        onTextColorButtonClick={handleTextColorButtonClick}
      />

      {/* エディター本体 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div
          ref={contentRef}
          contentEditable
          suppressContentEditableWarning
          className="p-4 min-h-full outline-none prose prose-zinc dark:prose-invert max-w-none note-editor"
          onInput={onEditorInput}
          onKeyDown={onEditorKeyDown}
          style={{ lineHeight: '1.8', fontSize: '16px' }}
        />
      </div>

      {/* フッター */}
      <div className="flex items-center justify-between p-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>
            作成: {new Date(note.createdAt).toLocaleDateString('ja-JP')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>
            更新: {new Date(note.updatedAt).toLocaleDateString('ja-JP')}
          </span>
        </div>
      </div>
    </div>
  );
}
