'use client';

/**
 * InlineMicButton
 *
 * Small microphone button that can be placed inside any input field.
 * Opens the global voice input bar targeting the associated input element.
 */
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Mic } from 'lucide-react';
import { useVoiceInput } from './VoiceInputProvider';
import { VOICE_INPUT_DISABLED } from './VoiceInputProvider';

interface InlineMicButtonProps {
  /** The input element to target (pass via ref). */
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Callback mode: receive text directly instead of targeting an input element. */
  onText?: (text: string) => void;
  /** Additional CSS classes. */
  className?: string;
}

// NOTE: voice input disabled — the gate wrapper below keeps hooks
// unconditional inside the inner component (rules-of-hooks).
function InlineMicButtonInner({ inputRef, onText, className }: InlineMicButtonProps) {
  const { openVoiceInput } = useVoiceInput();
  const t = useTranslations('devTools');

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
      aria-label={t('voice.inlineMicButton.ariaLabel')}
      title={t('voice.inlineMicButton.title')}
    >
      <Mic className="w-4 h-4" />
    </button>
  );
}

export default function InlineMicButton(props: InlineMicButtonProps) {
  if (VOICE_INPUT_DISABLED) return null;
  return <InlineMicButtonInner {...props} />;
}
