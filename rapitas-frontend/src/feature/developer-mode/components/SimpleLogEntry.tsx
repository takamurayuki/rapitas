/**
 * SimpleLogEntry
 *
 * Clean, icon-only log entry renderer for simple mode.
 * No emoji — all visual cues come from lucide-react icons and color coding.
 */
import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Code,
  FileEdit,
  FilePlus,
  FileSearch,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  HelpCircle,
  Info,
  Loader,
  MessageSquare,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Terminal,
  TestTube,
  Timer,
  Upload,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { UserFriendlyLogEntry } from '../utils/log-message-transformer';

/**
 * Icon lookup table — maps iconName strings to lucide components.
 */
const ICONS: Record<string, React.FC<{ className?: string }>> = {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle,
  ClipboardList,
  Clock,
  Code,
  FileEdit,
  FilePlus,
  FileSearch,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  HelpCircle,
  Info,
  Loader,
  MessageSquare,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Terminal,
  TestTube,
  Timer,
  Upload,
  Wrench,
  XCircle,
};

function getIcon(name?: string): React.FC<{ className?: string }> {
  return (name && ICONS[name]) || Info;
}

// ── Styles per category ────────────────────────────────

const CATEGORY_STYLES: Record<
  string,
  {
    row: string;
    icon: string;
    text: string;
  }
> = {
  success: {
    row: 'bg-green-950/20',
    icon: 'text-green-400',
    text: 'text-green-300',
  },
  error: { row: 'bg-red-950/20', icon: 'text-red-400', text: 'text-red-300' },
  warning: {
    row: 'bg-amber-950/20',
    icon: 'text-amber-400',
    text: 'text-amber-300',
  },
  progress: { row: '', icon: 'text-blue-400', text: 'text-blue-300' },
  info: { row: '', icon: 'text-zinc-400', text: 'text-zinc-300' },
  'agent-text': { row: '', icon: 'text-zinc-500', text: 'text-zinc-400' },
  'tool-result': { row: '', icon: 'text-zinc-600', text: 'text-zinc-500' },
  'phase-transition': {
    row: '',
    icon: 'text-indigo-400',
    text: 'text-indigo-300',
  },
};

function getStyles(category: string) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.info;
}

/** Optional search highlighting threaded from the viewer into each entry. */
interface HighlightProps {
  searchQuery?: string;
  highlightText?: (text: string, query: string) => React.ReactNode;
}

/** Render `text`, wrapping the active search match when highlighting is enabled. */
function hl(text: string, hp: HighlightProps): React.ReactNode {
  return hp.searchQuery && hp.highlightText ? hp.highlightText(text, hp.searchQuery) : text;
}

// ── Phase transition ───────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  research: 'border-blue-500/40 text-blue-300 bg-blue-500/10',
  plan: 'border-purple-500/40 text-purple-300 bg-purple-500/10',
  implement: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  verify: 'border-green-500/40 text-green-300 bg-green-500/10',
};

const PhaseEntry: React.FC<{ entry: UserFriendlyLogEntry; isNew: boolean } & HighlightProps> = ({
  entry,
  isNew,
  ...hp
}) => {
  const color = entry.phase
    ? PHASE_COLORS[entry.phase] || PHASE_COLORS.research
    : PHASE_COLORS.research;

  return (
    <div className="my-2" style={{ animation: isNew ? 'fadeInSlide 0.3s ease-out' : undefined }}>
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-zinc-700/60" />
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${color}`}
        >
          {React.createElement(getIcon(entry.iconName), {
            className: 'w-3.5 h-3.5',
          })}
          <span>{hl(entry.message, hp)}</span>
        </div>
        <div className="h-px flex-1 bg-zinc-700/60" />
      </div>
    </div>
  );
};

// ── Tool result (inline) ───────────────────────────────

const ToolResultRow: React.FC<{ entry: UserFriendlyLogEntry } & HighlightProps> = ({
  entry,
  ...hp
}) => (
  <div className="flex items-center gap-1.5 pl-8 pr-3 py-px text-xs text-zinc-600">
    <Check className="w-3 h-3 flex-shrink-0" />
    <span className="truncate">{hl(entry.message, hp)}</span>
  </div>
);

// ── Agent text block ───────────────────────────────────

const AgentTextRow: React.FC<
  {
    entry: UserFriendlyLogEntry;
    isNew: boolean;
  } & HighlightProps
> = ({ entry, isNew, ...hp }) => {
  const [open, setOpen] = useState(false);
  const hasMore = !!entry.detail;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-1.5 ${hasMore ? 'cursor-pointer' : ''}`}
      onClick={() => hasMore && setOpen(!open)}
      style={{ animation: isNew ? 'fadeInSlide 0.3s ease-out' : undefined }}
    >
      <MessageSquare className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-400 leading-relaxed">{hl(entry.message, hp)}</p>
        {hasMore && (
          <>
            <button className="flex items-center gap-0.5 mt-0.5 text-xs text-zinc-600 hover:text-zinc-400">
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {open ? '閉じる' : '全文'}
            </button>
            {open && (
              <pre className="mt-1 p-2 bg-zinc-900/60 rounded text-xs text-zinc-500 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {hl(entry.detail ?? '', hp)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Standard row ───────────────────────────────────────

interface SimpleLogEntryProps extends HighlightProps {
  entry: UserFriendlyLogEntry;
  index: number;
  isNewEntry?: boolean;
}

export const SimpleLogEntry: React.FC<SimpleLogEntryProps> = ({
  entry,
  index,
  isNewEntry = false,
  searchQuery,
  highlightText,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const hp: HighlightProps = { searchQuery, highlightText };

  if (entry.category === 'phase-transition')
    return <PhaseEntry entry={entry} isNew={isNewEntry} {...hp} />;
  if (entry.category === 'tool-result') return <ToolResultRow entry={entry} {...hp} />;
  if (entry.category === 'agent-text')
    return <AgentTextRow entry={entry} isNew={isNewEntry} {...hp} />;

  const s = getStyles(entry.category);

  return (
    <div
      key={index}
      className={`flex items-start gap-2 px-3 py-1 ${s.row} ${entry.detail ? 'cursor-pointer' : ''}`}
      onClick={() => entry.detail && setShowDetail(!showDetail)}
      style={{
        animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
      }}
    >
      {React.createElement(getIcon(entry.iconName), {
        className: `w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${s.icon}`,
      })}
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${s.text}`}>{hl(entry.message, hp)}</span>
        {entry.detail && showDetail && (
          <pre className="mt-1 p-2 bg-zinc-900/50 rounded text-xs text-zinc-500 whitespace-pre-wrap">
            {hl(entry.detail, hp)}
          </pre>
        )}
      </div>
      {entry.category === 'progress' && (
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse mt-1.5 flex-shrink-0" />
      )}
    </div>
  );
};

/**
 * Renders a list of simple log entries.
 */
export const SimpleLogEntryList: React.FC<
  {
    entries: UserFriendlyLogEntry[];
    newEntriesCount?: number;
  } & HighlightProps
> = ({ entries, newEntriesCount = 0, searchQuery, highlightText }) => {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500">
        <div className="text-center">
          <Loader className="w-6 h-6 mx-auto mb-2 text-zinc-600 animate-spin" />
          <p className="text-sm">実行ログを待機中...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry, i) => (
        <SimpleLogEntry
          key={i}
          entry={entry}
          index={i}
          isNewEntry={i >= entries.length - newEntriesCount}
          searchQuery={searchQuery}
          highlightText={highlightText}
        />
      ))}
    </div>
  );
};

export default SimpleLogEntry;
