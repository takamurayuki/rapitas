'use client';
// CopilotChatPanel — AI copilot chat with cost-optimized model routing.
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles, Trash2, Cpu, Cloud, Database } from 'lucide-react';
import { useCopilotChat, type CopilotMessage } from './useCopilotChat';

interface CopilotChatPanelProps {
  taskId?: number;
  className?: string;
}

function TierBadge({ tier, model, cached }: { tier?: string; model?: string; cached?: boolean }) {
  if (cached) return <span className="text-[10px] text-emerald-500 flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />cache</span>;
  if (tier === 'free') return <span className="text-[10px] text-green-500 flex items-center gap-0.5"><Cpu className="w-2.5 h-2.5" />local</span>;
  if (tier === 'economy') return <span className="text-[10px] text-blue-400 flex items-center gap-0.5"><Cloud className="w-2.5 h-2.5" />haiku</span>;
  if (tier === 'standard') return <span className="text-[10px] text-purple-400 flex items-center gap-0.5"><Cloud className="w-2.5 h-2.5" />sonnet</span>;
  return null;
}

function MessageBubble({ msg }: { msg: CopilotMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
        isUser
          ? 'bg-indigo-600 text-white'
          : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
      }`}>
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {!isUser && (msg.tier || msg.cached) && (
          <div className="mt-1.5 flex justify-end">
            <TierBadge tier={msg.tier} model={msg.model} cached={msg.cached} />
          </div>
        )}
      </div>
    </div>
  );
}

export function CopilotChatPanel({ taskId, className = '' }: CopilotChatPanelProps) {
  const { messages, isLoading, error, sendMessage, clearChat } = useCopilotChat(taskId);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className={`flex flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            AI コパイロット
          </h3>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            cache → local → haiku → sonnet
          </span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title="チャットをクリア"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ minHeight: '200px', maxHeight: '400px' }}>
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
            {taskId
              ? 'タスクについて質問してみてください'
              : 'AIコパイロットに何でも聞いてください'}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="rounded-xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            </div>
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-700">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力..."
          disabled={isLoading}
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
