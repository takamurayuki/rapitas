'use client';

/**
 * InlineMicButton
 *
 * Small microphone button that can be placed inside any input field.
 * Opens the global voice input bar targeting the associated input element.
 */
import { useCallback, useRef } from 'react';
import { Mic } from 'lucide-react';
import { useVoiceInput } from './VoiceInputProvider';

interface InlineMicButtonProps {
  /** The input element to target (pass via ref). */
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Callback mode: receive text directly instead of targeting an input element. */
  onText?: (text: string) => void;
  /** Additional CSS classes. */
  className?: string;
}

export default function InlineMicButton({
  inputRef,
  onText,
  className,
}: InlineMicButtonProps) {
  const { openVoiceInput } = useVoiceInput();

  const handleClick = useCallback(() => {
    if (onText) {
      openVoiceInput({ type: 'callback', onText });
    } else if (inputRef?.current) {
      openVoiceInput({ type: 'input', element: inputRef.current });
    } else {
      openVoiceInput({ type: 'command' });
    }
  }, [openVoiceInput, inputRef, onText]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`p-1 text-zinc-400 hover:text-indigo-500 transition-colors ${className || ''}`}
      aria-label="音声入力"
      title="音声入力 (Ctrl+Shift+V)"
    >
      <Mic className="w-4 h-4" />
    </button>
  );
}
