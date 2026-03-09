'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Command, ArrowRight, Loader2, BookOpen, ListTodo, Compass, Zap } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useTranslations } from 'next-intl';
import { useShortcutStore } from '@/stores/shortcutStore';

type Intent = 'create_task' | 'start_learning' | 'navigate' | 'search';

export default function SmartCommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const t = useTranslations('commandBar');
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const commandBarShortcut = shortcuts.find((s) => s.id === 'commandBar');

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) {
        setInput('');
      }
      return !prev;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check against the stored shortcut binding
      const binding = commandBarShortcut;
      if (binding) {
        const keyMatch = e.key.toUpperCase() === binding.key.toUpperCase();
        const metaMatch = binding.meta ? (e.metaKey || e.ctrlKey) : true;
        const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey;
        const ctrlMatch = binding.ctrl ? e.ctrlKey : true;

        if (keyMatch && metaMatch && shiftMatch && ctrlMatch) {
          e.preventDefault();
          handleToggle();
          return;
        }
      }

      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleToggle, commandBarShortcut]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;
    setIsProcessing(true);

    try {
      const res = await fetch(`${API_BASE_URL}/smart-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      });

      if (res.ok) {
        const result = await res.json();
        const { intent, action } = result;

        setIsOpen(false);

        switch (intent as Intent) {
          case 'create_task':
            router.push(`${action.route}?nl=${encodeURIComponent(action.prefill || input)}`);
            break;
          case 'start_learning':
            router.push(`${action.route}?title=${encodeURIComponent(action.prefill || input)}`);
            break;
          case 'navigate':
            router.push(action.route);
            break;
          case 'search':
            router.push(`${action.route}?q=${encodeURIComponent(action.query || input)}`);
            break;
        }
      }
    } catch (e) {
      console.error('Smart action failed:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      {/* Command bar */}
      <div className="relative w-full max-w-xl mx-4 bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-zinc-100 dark:border-zinc-700">
          <Zap className="w-5 h-5 text-purple-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={t('placeholder')}
            className="flex-1 bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border-none outline-none"
            disabled={isProcessing}
          />
          {isProcessing ? (
            <Loader2 className="w-5 h-5 text-purple-500 animate-spin shrink-0" />
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="p-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Hints */}
        <div className="px-4 py-3 space-y-1.5">
          <HintItem icon={ListTodo} color="text-violet-500" text={t('hintTask')} example={t('hintTaskExample')} />
          <HintItem icon={BookOpen} color="text-emerald-500" text={t('hintLearn')} example={t('hintLearnExample')} />
          <HintItem icon={Compass} color="text-blue-500" text={t('hintNavigate')} example={t('hintNavigateExample')} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-700 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span className="flex items-center gap-1">
            <Command className="w-3 h-3" />
            <span>+K {t('toToggle')}</span>
          </span>
          <span>Esc {t('toClose')}</span>
        </div>
      </div>
    </div>
  );
}

function HintItem({ icon: Icon, color, text, example }: { icon: typeof Search; color: string; text: string; example: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <span className="text-zinc-600 dark:text-zinc-400">{text}</span>
      <span className="text-zinc-400 dark:text-zinc-500 text-xs">— {example}</span>
    </div>
  );
}
