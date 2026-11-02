'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MoreVertical } from 'lucide-react';

export interface DropdownMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  triggerClassName?: string;
  menuClassName?: string;
  triggerLabel?: string;
  menuLabel?: string;
  /** 'bordered' (default) shows an outline + shadow; 'ghost' is flat with a hover background. */
  variant?: 'bordered' | 'ghost';
  /**
   * Controlled open state. Pass it when something other than the trigger
   * opens the menu — a right-click on a tab, say. Omit for the usual
   * self-managed behaviour.
   */
  open?: boolean;
  /** Asked to open or close while controlled; the owner decides. */
  onOpenChange?: (open: boolean) => void;
  /** Drop the built-in button when the menu is opened from elsewhere. */
  hideTrigger?: boolean;
  /** Which edge the menu is pinned to. Default 'right'. */
  align?: 'left' | 'right';
}

export default function DropdownMenu({
  items,
  triggerClassName = '',
  menuClassName = '',
  triggerLabel,
  menuLabel,
  variant = 'bordered',
  open,
  onOpenChange,
  hideTrigger = false,
  align = 'right',
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  // Controlled whenever `open` is supplied. The owner then holds the state
  // and this only asks — closing itself would fight the next render.
  const controlled = open !== undefined;
  const isOpen = controlled ? open : uncontrolledOpen;
  // Through a ref so the callback below stays stable: an inline
  // `onOpenChange` from the caller would otherwise re-subscribe the
  // outside-click and Escape listeners on every render.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledOpen(next);
      onOpenChangeRef.current?.(next);
    },
    [controlled],
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // `triggerRef` is empty when the trigger is hidden, which must still
      // count as "clicked outside" rather than skipping the close.
      const inMenu = menuRef.current?.contains(event.target as Node) ?? false;
      const onTrigger = triggerRef.current?.contains(event.target as Node) ?? false;
      if (!inMenu && !onTrigger) setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, setIsOpen]);

  const handleItemClick = (item: DropdownMenuItem) => {
    if (!item.disabled) {
      item.onClick();
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      {!hideTrigger && (
        <button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center justify-center px-2 py-2 rounded-lg transition-all duration-300 ${
            variant === 'bordered' ? 'border border-zinc-200 dark:border-zinc-700 shadow-sm' : ''
          } ${
            isOpen
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
              : variant === 'ghost'
                ? 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300'
                : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-300'
          } ${triggerClassName}`}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-label={triggerLabel}
        >
          <MoreVertical className="w-4 h-4" aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={menuLabel}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-2 min-w-[180px] bg-white dark:bg-indigo-dark-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 py-1.5 z-50 ${menuClassName}`}
        >
          {items.map((item, index) => (
            <button
              key={index}
              role="menuitem"
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left ${
                item.variant === 'danger'
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {item.icon && (
                <span className="w-4 h-4 shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
