'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';

type AccordionContextType = {
  expandedItems: string[];
  toggleItem: (id: string) => void;
  isExpanded: (id: string) => boolean;
  allowMultiple: boolean;
};

const AccordionContext = createContext<AccordionContextType | null>(null);

export function useAccordionContext() {
  const context = useContext(AccordionContext);
  if (!context) {
    throw new Error('Accordion components must be used within an Accordion');
  }
  return context;
}

type AccordionProps = {
  children: ReactNode;
  defaultExpanded?: string[];
  allowMultiple?: boolean;
  className?: string;
};

export function Accordion({
  children,
  defaultExpanded = [],
  allowMultiple = false,
  className = '',
}: AccordionProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>(defaultExpanded);

  const toggleItem = useCallback(
    (id: string) => {
      setExpandedItems((prev) => {
        if (prev.includes(id)) {
          return prev.filter((item) => item !== id);
        }
        return allowMultiple ? [...prev, id] : [id];
      });
    },
    [allowMultiple],
  );

  const isExpanded = useCallback(
    (id: string) => expandedItems.includes(id),
    [expandedItems],
  );

  return (
    <AccordionContext.Provider
      value={{ expandedItems, toggleItem, isExpanded, allowMultiple }}
    >
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

type AccordionItemProps = {
  id: string;
  children: ReactNode;
  className?: string;
};

export function AccordionItem({
  id,
  children,
  className = '',
}: AccordionItemProps) {
  return (
    <div
      className={`border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 ${className}`}
    >
      {children}
    </div>
  );
}

type AccordionTriggerProps = {
  id: string;
  children: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  className?: string;
};

export function AccordionTrigger({
  id,
  children,
  icon,
  badge,
  className = '',
}: AccordionTriggerProps) {
  const { toggleItem, isExpanded } = useAccordionContext();
  const expanded = isExpanded(id);

  return (
    <button
      type="button"
      onClick={() => toggleItem(id)}
      className={`w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${className}`}
      aria-expanded={expanded}
      aria-controls={`accordion-content-${id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="font-medium text-sm text-zinc-700 dark:text-zinc-300 truncate">
          {children}
        </span>
        {badge && <span className="shrink-0">{badge}</span>}
      </div>
      <ChevronDown
        className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-200 ${
          expanded ? 'rotate-180' : ''
        }`}
      />
    </button>
  );
}

type AccordionContentProps = {
  id: string;
  children: ReactNode;
  className?: string;
};

export function AccordionContent({
  id,
  children,
  className = '',
}: AccordionContentProps) {
  const { isExpanded } = useAccordionContext();
  const expanded = isExpanded(id);

  if (!expanded) return null;

  return (
    <div
      id={`accordion-content-${id}`}
      className={`px-4 pt-2 pb-4 animate-in slide-in-from-top-1 duration-200 ${className}`}
    >
      {children}
    </div>
  );
}

type CompactAccordionGroupProps = {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
};

export function CompactAccordionGroup({
  title,
  icon,
  badge,
  headerExtra,
  children,
  defaultExpanded = false,
  className = '',
}: CompactAccordionGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      className={`border-b border-zinc-100 dark:border-zinc-800 ${className}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-zinc-400">{icon}</span>}
          <span className="font-medium text-sm text-zinc-500 dark:text-zinc-400">
            {title}
          </span>
          {badge && <span className="shrink-0">{badge}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headerExtra && (
            <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>
          )}
          <ChevronDown
            className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>
      {expanded && (
        <div className="px-4 pt-2 pb-4 animate-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}

type InlineFieldGroupProps = {
  children: ReactNode;
  className?: string;
};

export function InlineFieldGroup({
  children,
  className = '',
}: InlineFieldGroupProps) {
  return (
    <div className={`flex flex-wrap items-start gap-4 ${className}`}>
      {children}
    </div>
  );
}

type FieldItemProps = {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
};

export function FieldItem({
  label,
  icon,
  children,
  className = '',
  fullWidth = false,
}: FieldItemProps) {
  return (
    <div
      className={`${fullWidth ? 'w-full' : 'flex-1 min-w-[140px]'} ${className}`}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className="text-zinc-400 dark:text-white">{icon}</span>}
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
