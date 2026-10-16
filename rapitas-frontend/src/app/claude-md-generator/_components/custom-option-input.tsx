'use client';
// custom-option-input

import { useState } from 'react';
import { isImeComposing } from '@/utils/ime';

interface CustomOptionInputProps {
  /** Placeholder shown in the text field / 入力欄のプレースホルダ */
  placeholder: string;
  /** Label for the add button / 追加ボタンのラベル */
  addLabel: string;
  /** Called with the entered text when the user adds it / 追加時に入力テキストを渡す */
  onAdd: (label: string) => void;
}

/**
 * Free-text input row for adding a custom option to a multi-select phase.
 * Adds on Enter or button click, then clears. Keeps its own draft state so the
 * parent only hears about committed entries.
 *
 * @param props - CustomOptionInputProps / CustomOptionInputProps参照
 */
export function CustomOptionInput({ placeholder, addLabel, onAdd }: CustomOptionInputProps) {
  const [value, setValue] = useState('');

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue('');
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isImeComposing(e)) {
            e.preventDefault();
            commit();
          }
        }}
        style={{
          flex: 1,
          background: 'var(--s1)',
          border: '1.5px solid var(--border)',
          borderRadius: 9,
          padding: '11px 14px',
          color: 'var(--text)',
          fontSize: 14,
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <button
        className="btn btn-outline"
        onClick={commit}
        disabled={!value.trim()}
        style={{ padding: '11px 18px', fontSize: 14, opacity: value.trim() ? 1 : 0.4 }}
      >
        + {addLabel}
      </button>
    </div>
  );
}
