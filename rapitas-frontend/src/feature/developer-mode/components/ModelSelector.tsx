"use client";

import { useState, useRef, useEffect, memo } from "react";
import { ChevronDown, Terminal, Zap, Globe, Check } from "lucide-react";
import type { AIAgentConfig } from "@/types";
import {
  PROVIDER_CONFIGS,
  getModelName,
  getProviderLabel,
} from "../constants/provider-configs";

type Props = {
  agents: AIAgentConfig[];
  selectedAgentId: number | null;
  onSelect: (agentId: number) => void;
  disabled?: boolean;
};

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  "claude-code": <Terminal className="w-3 h-3" />,
  "anthropic-api": <Terminal className="w-3 h-3" />,
  codex: <Zap className="w-3 h-3" />,
  openai: <Zap className="w-3 h-3" />,
  "azure-openai": <Globe className="w-3 h-3" />,
  gemini: <Globe className="w-3 h-3" />,
};

export const ModelSelector = memo(function ModelSelector({
  agents,
  selectedAgentId,
  onSelect,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = agents.find((a) => a.id === selectedAgentId);
  const label = selected
    ? `${getProviderLabel(selected.agentType)} / ${getModelName(selected.agentType, selected.modelId || "")}`
    : "エージェント未選択";

  const grouped = agents.reduce(
    (acc, a) => {
      const key = a.agentType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(a);
      return acc;
    },
    {} as Record<string, AIAgentConfig[]>,
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-md text-zinc-300 disabled:opacity-50 transition-colors"
      >
        {selected && PROVIDER_ICONS[selected.agentType]}
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl z-50 overflow-hidden">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <div className="px-2 py-1 text-[9px] font-medium text-zinc-500 uppercase tracking-wider bg-zinc-900/50">
                {PROVIDER_ICONS[type]}
                <span className="ml-1">{getProviderLabel(type)}</span>
              </div>
              {items.map((agent) => {
                const isSelected = agent.id === selectedAgentId;
                const modelName = getModelName(
                  agent.agentType,
                  agent.modelId || "",
                );
                return (
                  <button
                    key={agent.id}
                    onClick={() => {
                      onSelect(agent.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-zinc-700 transition-colors ${
                      isSelected
                        ? "text-violet-400 bg-violet-900/20"
                        : "text-zinc-300"
                    }`}
                  >
                    <span className="flex-1 truncate">
                      {agent.name}
                      <span className="ml-1 text-zinc-500">({modelName})</span>
                    </span>
                    {isSelected && (
                      <Check className="w-3 h-3 text-violet-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {agents.length === 0 && (
            <div className="px-3 py-3 text-[10px] text-zinc-500 text-center">
              エージェント未設定
            </div>
          )}
        </div>
      )}
    </div>
  );
});
