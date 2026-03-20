'use client';

/**
 * MCPSetupGuide
 *
 * Shows setup instructions for connecting IDEs to Rapitas via MCP.
 * Provides copy-paste config snippets for Cursor, Claude Code, etc.
 */
import React, { useState } from 'react';
import { Plug, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

const MCP_CONFIG = `{
  "mcpServers": {
    "rapitas": {
      "url": "http://localhost:3001/mcp",
      "transport": "http"
    }
  }
}`;

const CLAUDE_CODE_CONFIG = `// ~/.claude/claude_desktop_config.json
{
  "mcpServers": {
    "rapitas": {
      "command": "curl",
      "args": ["-s", "http://localhost:3001/mcp/tools"]
    }
  }
}`;

export function MCPSetupGuide() {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
      >
        <Plug className="w-4 h-4 text-blue-500" />
        MCP連携 (IDE統合)
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Cursor、Claude Code、WindsurfなどのIDEからRapitasのタスク管理を直接操作できます
          </p>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Cursor / Windsurf 設定
              </span>
              <button
                onClick={() => copyToClipboard(MCP_CONFIG, 'cursor')}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-violet-500 transition-colors"
              >
                {copied === 'cursor' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied === 'cursor' ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <pre className="text-xs bg-zinc-900 text-zinc-300 p-3 rounded-lg overflow-x-auto font-mono">
              {MCP_CONFIG}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Claude Code 設定
              </span>
              <button
                onClick={() => copyToClipboard(CLAUDE_CODE_CONFIG, 'claude')}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-violet-500 transition-colors"
              >
                {copied === 'claude' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied === 'claude' ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <pre className="text-xs bg-zinc-900 text-zinc-300 p-3 rounded-lg overflow-x-auto font-mono">
              {CLAUDE_CODE_CONFIG}
            </pre>
          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
            <p>利用可能なツール: タスク一覧/作成/更新、ワークフロー管理、進捗サマリー</p>
            <p>
              API確認:{' '}
              <code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-600 dark:text-zinc-400">
                GET http://localhost:3001/mcp/info
              </code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
