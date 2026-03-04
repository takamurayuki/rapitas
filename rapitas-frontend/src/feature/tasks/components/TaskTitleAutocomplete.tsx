'use client';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { Priority } from '@/types';

const API_BASE = API_BASE_URL;

type TaskSuggestion = {
  id: number;
  title: string;
  priority: Priority;
  status: string;
  theme?: {
    id: number;
    name: string;
    color: string;
  } | null;
};

type TaskTitleAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  themeId?: number | null;
  projectId?: number | null;
};

export type TaskTitleAutocompleteRef = {
  focus: () => void;
};

const TaskTitleAutocomplete = forwardRef<
  TaskTitleAutocompleteRef,
  TaskTitleAutocompleteProps
>(function TaskTitleAutocomplete(
  {
    value,
    onChange,
    placeholder = 'タスクのタイトル',
    className = '',
    autoFocus = false,
    themeId,
    projectId,
  },
  ref,
) {
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  // Find inline completion suggestion (first matching title that starts with the input)
  const inlineSuggestion = useMemo(() => {
    if (!value.trim() || suggestions.length === 0) return null;

    const lowerValue = value.toLowerCase();
    const match = suggestions.find((s) =>
      s.title.toLowerCase().startsWith(lowerValue),
    );

    return match ? match.title : null;
  }, [value, suggestions]);

  // The ghost text to display (the completion part only)
  const ghostText = useMemo(() => {
    if (!inlineSuggestion || !value) return null;
    return inlineSuggestion.slice(value.length);
  }, [inlineSuggestion, value]);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query.trim() || query.length < 1) {
        setSuggestions([]);
        return;
      }

      try {
        const params = new URLSearchParams({ q: query, limit: '10' });
        if (themeId) params.append('themeId', themeId.toString());
        if (projectId) params.append('projectId', projectId.toString());

        const url = `${API_BASE}/tasks/search?${params}`;
        const res = await fetch(url);

        if (!res.ok) {
          // Log for debugging, but don't throw
          console.debug(`Autocomplete API returned ${res.status}: ${url}`);
          setSuggestions([]);
          return;
        }

        const data: TaskSuggestion[] = await res.json();
        setSuggestions(data);
      } catch (e) {
        // Network error - backend might not be running
        console.debug(
          'Autocomplete fetch failed (backend might not be running):',
          e,
        );
        setSuggestions([]);
      }
    },
    [themeId, projectId],
  );

  // Debounced search effect
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 150);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, fetchSuggestions]);

  // Handle keyboard events
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Tab to accept inline completion
    if (e.key === 'Tab' && ghostText && inlineSuggestion) {
      e.preventDefault();
      onChange(inlineSuggestion);
    }
    // Right arrow at end of input to accept completion
    if (
      e.key === 'ArrowRight' &&
      ghostText &&
      inlineSuggestion &&
      inputRef.current
    ) {
      const cursorPos = inputRef.current.selectionStart;
      if (cursorPos === value.length) {
        e.preventDefault();
        onChange(inlineSuggestion);
      }
    }
  };

  return (
    <div className="relative w-full">
      {/* Ghost text layer (positioned behind input) */}
      <div
        className="absolute inset-0 pointer-events-none flex items-center"
        aria-hidden="true"
      >
        <span className="text-xl font-semibold text-transparent whitespace-pre">
          {value}
        </span>
        {isFocused && ghostText && (
          <span className="text-xl font-semibold text-zinc-300 dark:text-zinc-600">
            {ghostText}
          </span>
        )}
      </div>

      {/* Actual input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className={`relative w-full text-xl font-semibold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600 ${className}`}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-autocomplete="inline"
        style={{ caretColor: 'currentColor' }}
      />

      {/* Tab hint */}
      {isFocused && ghostText && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 pointer-events-none">
          <kbd className="px-1.5 py-0.5 bg-zinc-100 dark:bg-indigo-dark-800 rounded text-[10px] font-mono border border-zinc-200 dark:border-zinc-700">
            Tab
          </kbd>
        </div>
      )}
    </div>
  );
});

export default TaskTitleAutocomplete;
