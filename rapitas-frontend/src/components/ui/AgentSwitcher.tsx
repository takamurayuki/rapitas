'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  ChevronDown,
  Terminal,
  Zap,
  Activity,
  Globe,
  Cpu,
  Star,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { AIAgentConfig } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
const logger = createLogger('AgentSwitcher');

type AgentSwitcherProps = {
  /** Currently selected agent ID (null means default) */
  selectedAgentId?: number | null;
  /** Callback when an agent is selected */
  onSelect: (agentId: number | null) => void;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Whether to show label */
  showLabel?: boolean;
};

const AGENT_TYPE_INFO: Record<string, { name: string; icon: React.ReactNode; color: string }> = {
  'claude-code': {
    name: 'Claude Code',
    icon: <Terminal className="w-4 h-4" />,
    color: 'text-orange-500',
  },
  'anthropic-api': {
    name: 'Anthropic API',
    icon: <Terminal className="w-4 h-4" />,
    color: 'text-orange-500',
  },
  codex: {
    name: 'OpenAI Codex',
    icon: <Zap className="w-4 h-4" />,
    color: 'text-green-500',
  },
  openai: {
    name: 'OpenAI',
    icon: <Zap className="w-4 h-4" />,
    color: 'text-green-500',
  },
  'azure-openai': {
    name: 'Azure OpenAI',
    icon: <Globe className="w-4 h-4" />,
    color: 'text-blue-500',
  },
  gemini: {
    name: 'Google Gemini',
    icon: <Activity className="w-4 h-4" />,
    color: 'text-blue-500',
  },
  custom: {
    name: 'カスタム',
    icon: <Cpu className="w-4 h-4" />,
    color: 'text-zinc-500',
  },
};

function getTypeInfo(type: string) {
  return (
    AGENT_TYPE_INFO[type] || {
      name: type,
      icon: <Cpu className="w-4 h-4" />,
      color: 'text-zinc-500',
    }
  );
}

export function AgentSwitcher({
  selectedAgentId,
  onSelect,
  size = 'md',
  showLabel = true,
}: AgentSwitcherProps) {
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents`);
      if (res.ok) {
        setAgents(await res.json());
      }
    } catch {
      logger.error('Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const defaultAgent = agents.find((a) => a.isDefault);
  const displayAgent = selectedAgent || defaultAgent;

  const isSm = size === 'sm';

  if (loading) {
    return (
      <div
        className={`flex items-center gap-2 px-3 ${isSm ? 'py-1.5' : 'py-2'} bg-zinc-100 dark:bg-zinc-800 rounded-lg`}
      >
        <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
        <span className="text-xs text-zinc-400">読込中...</span>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div
        className={`flex items-center gap-2 px-3 ${isSm ? 'py-1.5' : 'py-2'} bg-zinc-100 dark:bg-zinc-800 rounded-lg`}
      >
        <Bot className="w-4 h-4 text-zinc-400" />
        <span className="text-xs text-zinc-400">Claude Code（ビルトイン）</span>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      {showLabel && (
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
          実行エージェント
        </label>
      )}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-2 w-full ${isSm ? 'px-2.5 py-1.5' : 'px-3 py-2'} bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors text-left`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {displayAgent ? (
            <>
              <span className={getTypeInfo(displayAgent.agentType).color}>
                {getTypeInfo(displayAgent.agentType).icon}
              </span>
              <span
                className={`${isSm ? 'text-xs' : 'text-sm'} font-medium text-zinc-900 dark:text-zinc-100 truncate`}
              >
                {displayAgent.name}
              </span>
              {displayAgent.isDefault && !selectedAgentId && (
                <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded">
                  デフォルト
                </span>
              )}
            </>
          ) : (
            <>
              <Bot className="w-4 h-4 text-zinc-400" />
              <span className={`${isSm ? 'text-xs' : 'text-sm'} text-zinc-500 dark:text-zinc-400`}>
                エージェントを選択
              </span>
            </>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden">
          {/* Reset to default option */}
          {selectedAgentId && defaultAgent && (
            <button
              onClick={() => {
                onSelect(null);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors border-b border-zinc-100 dark:border-zinc-700"
            >
              <Star className="w-4 h-4 text-indigo-500" />
              <div className="flex-1 text-left">
                <span className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">
                  デフォルトに戻す
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-1.5">
                  ({defaultAgent.name})
                </span>
              </div>
            </button>
          )}

          {/* Agent list */}
          <div className="max-h-[240px] overflow-y-auto">
            {agents.map((agent) => {
              const info = getTypeInfo(agent.agentType);
              const isSelected =
                agent.id === selectedAgentId || (!selectedAgentId && agent.isDefault);

              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    onSelect(agent.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/20'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                  }`}
                >
                  <span className={info.color}>{info.icon}</span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {agent.name}
                      </span>
                      {agent.isDefault && (
                        <Star className="w-3 h-3 text-indigo-500 fill-indigo-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                      {info.name}
                      {agent.modelId && ` / ${agent.modelId}`}
                    </p>
                  </div>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
