'use client';
// useNotePopups
import { useCallback, useEffect, useState } from 'react';

/** All values and helpers returned by useNotePopups. */
export interface NotePopupsState {
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
  closeOtherPopups: (except: 'link' | 'code') => void;
}

/**
 * State and coordination for NoteEditor's popup overlays.
 *
 * @returns A flat NotePopupsState consumed by useNoteEditor and the toolbar.
 */
export function useNotePopups(): NotePopupsState {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBorderPicker, setShowBorderPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);

  const closeAllPopups = useCallback(() => {
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowLinkInput(false);
    setShowCodeInput(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
  }, []);

  // NOTE: "except" lets the caller open one popup (link or code) without
  // immediately closing it on the next render.
  const closeOtherPopups = useCallback((except: 'link' | 'code') => {
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
    if (except !== 'link') setShowLinkInput(false);
    if (except !== 'code') setShowCodeInput(false);
  }, []);

  // Close popups on outside click or Escape
  useEffect(() => {
    const anyOpen =
      showColorPicker ||
      showBorderPicker ||
      showLinkInput ||
      showCodeInput ||
      showFontSizePicker ||
      showFontPicker ||
      showTextColorPicker;

    if (!anyOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isInsidePopup = target.closest('.absolute.top-full') !== null;
      const isButton =
        target.closest(
          'button[title="ハイライト"], button[title="縦線"], button[title="リンク挿入"], button[title="コードブロック挿入"], button[title="文字サイズ"], button[title="フォント"], button[title="文字色"]',
        ) !== null;
      if (!isInsidePopup && !isButton) closeAllPopups();
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

  return {
    showColorPicker,
    showBorderPicker,
    showLinkInput,
    showCodeInput,
    showFontSizePicker,
    showFontPicker,
    showTextColorPicker,
    setShowColorPicker,
    setShowBorderPicker,
    setShowLinkInput,
    setShowCodeInput,
    setShowFontSizePicker,
    setShowFontPicker,
    setShowTextColorPicker,
    closeAllPopups,
    closeOtherPopups,
  };
}
