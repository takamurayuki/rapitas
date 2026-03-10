'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  type Search,
  Command,
  ArrowRight,
  Loader2,
  BookOpen,
  ListTodo,
  Compass,
  Zap,
  MessageSquare,
  FileText,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useTranslations } from 'next-intl';
import { useShortcutStore } from '@/stores/shortcutStore';

type Intent = 'create_task' | 'start_learning' | 'navigate' | 'search';

type Suggestion = {
  id: number;
  title: string;
  type: 'task' | 'comment';
  status?: string;
  matchContext?: string;
  metadata?: Record<string, unknown>;
};

export default function SmartCommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const t = useTranslations('commandBar');
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const commandBarShortcut = Array.isArray(shortcuts)
    ? shortcuts.find((s) => s.id === 'commandBar')
    : undefined;

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
      if (binding && binding.key) {
        const keyMatch = e.key.toUpperCase() === binding.key.toUpperCase();
        const metaMatch = binding.meta ? e.metaKey || e.ctrlKey : true;
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
    if (!isOpen) {
      setSuggestions([]);
      setSelectedIndex(-1);
    }
  }, [isOpen]);

  // Debounced search suggestions
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = input.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setSelectedIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/search/suggest?q=${encodeURIComponent(trimmed)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setSuggestions(data.suggestions ?? []);
            setSelectedIndex(-1);
          }
        }
      } catch {
        // Silently fail for suggestions
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

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
            router.push(
              `${action.route}?nl=${encodeURIComponent(action.prefill || input)}`,
            );
            break;
          case 'start_learning':
            router.push(
              `${action.route}?title=${encodeURIComponent(action.prefill || input)}`,
            );
            break;
          case 'navigate':
            router.push(action.route);
            break;
          case 'search':
            router.push(
              `${action.route}?q=${encodeURIComponent(action.query || input)}`,
            );
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
              if (e.key === 'ArrowDown' && suggestions.length > 0) {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  prev < suggestions.length - 1 ? prev + 1 : 0,
                );
              } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  prev > 0 ? prev - 1 : suggestions.length - 1,
                );
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                  const s = suggestions[selectedIndex];
                  setIsOpen(false);
                  if (s.type === 'comment' && s.metadata?.taskId) {
                    router.push(`/tasks/detail?id=${s.metadata.taskId}`);
                  } else {
                    router.push(`/tasks/detail?id=${s.id}`);
                  }
                } else {
                  handleSubmit();
                }
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

        {/* Search results */}
        {suggestions.length > 0 ? (
          <div className="max-h-64 overflow-y-auto border-b border-zinc-100 dark:border-zinc-700">
            {suggestions.map((s, i) => (
              <button
                key={`${s.type}-${s.id}`}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? 'bg-purple-50 dark:bg-purple-900/30'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                }`}
                onClick={() => {
                  setIsOpen(false);
                  if (s.type === 'comment' && s.metadata?.taskId) {
                    router.push(`/tasks/detail?id=${s.metadata.taskId}`);
                  } else {
                    router.push(`/tasks/detail?id=${s.id}`);
                  }
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {s.type === 'task' ? (
                  <ListTodo className="w-4 h-4 text-violet-500 shrink-0" />
                ) : s.type === 'comment' ? (
                  <MessageSquare className="w-4 h-4 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-zinc-900 dark:text-zinc-100">
                    <HighlightText text={s.title} query={input} />
                  </div>
                  {s.matchContext === 'description' && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      matched in description
                    </span>
                  )}
                </div>
                {s.status && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                      s.status === 'done'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : s.status === 'in_progress'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
                    }`}
                  >
                    {s.status}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : isSearching ? (
          <div className="px-4 py-3 flex items-center gap-2 text-sm text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Searching...</span>
          </div>
        ) : null}

        {/* Hints */}
        {suggestions.length === 0 && (
          <div className="px-4 py-3 space-y-1.5">
            <HintItem
              icon={ListTodo}
              color="text-violet-500"
              text={t('hintTask')}
              example={t('hintTaskExample')}
            />
            <HintItem
              icon={BookOpen}
              color="text-emerald-500"
              text={t('hintLearn')}
              example={t('hintLearnExample')}
            />
            <HintItem
              icon={Compass}
              color="text-blue-500"
              text={t('hintNavigate')}
              example={t('hintNavigateExample')}
            />
          </div>
        )}

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

function HintItem({
  icon: Icon,
  color,
  text,
  example,
}: {
  icon: typeof Search;
  color: string;
  text: string;
  example: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <span className="text-zinc-600 dark:text-zinc-400">{text}</span>
      <span className="text-zinc-400 dark:text-zinc-500 text-xs">
        — {example}
      </span>
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const words = query.trim().split(/\s+/).filter(Boolean);
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span
            key={i}
            className="text-purple-600 dark:text-purple-400 font-medium"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
