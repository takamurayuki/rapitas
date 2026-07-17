/**
 * simple-log-entry/log-entry-icons
 *
 * Icon lookup for the friendly log rows — maps the iconName strings produced
 * by the log-classification pipeline to lucide components.
 */

import type React from 'react';
import {
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
  FileText,
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
  FileText,
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

/**
 * Resolve an iconName string to its lucide component (falls back to Info).
 *
 * @param name - iconName from a classified log entry. / 分類済みエントリのアイコン名
 * @returns The lucide icon component. / lucide アイコンコンポーネント
 */
export function getLogEntryIcon(name?: string): React.FC<{ className?: string }> {
  return (name && ICONS[name]) || Info;
}
