"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
  memo,
} from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Trash2,
  Sparkles,
  ChevronDown,
  AlertCircle,
  Minimize2,
  Settings,
} from "lucide-react";
import { useAIChat } from "./useAIChat";
import Link from "next/link";
import type { AIChatMessage } from "@/types";

type FloatingAIMenuProps = {
  systemPrompt?: string;
  placeholder?: string;
  title?: string;
  position?: "bottom-right" | "bottom-left";
  className?: string;
};

const ChatMessage = memo(function ChatMessage({
  message,
}: {
  message: AIChatMessage;
}) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
      role="listitem"
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-blue-500 text-white rounded-br-md"
            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </p>
        <span
          className={`text-[10px] mt-1 block ${
            isUser
              ? "text-blue-100"
              : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {message.timestamp.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
});

export default function FloatingAIMenu({
  systemPrompt = "あなたはRapi+アプリケーションのAIアシスタントです。ユーザーのタスク管理や学習計画に関する質問に日本語で丁寧に回答してください。",
  placeholder = "AIに質問する...",
  title = "AIアシスタント",
  position = "bottom-right",
  className = "",
}: FloatingAIMenuProps) {
  const [inputValue, setInputValue] = useState("");
  const [isHovering, setIsHovering] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isLoading,
    error,
    isExpanded,
    sendMessage,
    clearMessages,
    setExpanded,
    toggleExpanded,
  } = useAIChat({
    systemPrompt,
  });

  // メッセージリストを自動スクロール
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  // 展開時にinputにフォーカス
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  // 外側クリックで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        if (isExpanded && !isHovering) {
          setExpanded(false);
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded, isHovering, setExpanded]);

  // Escキーで閉じる
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && isExpanded) {
        setExpanded(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, setExpanded]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue;
    setInputValue("");
    await sendMessage(message);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enterで送信、Shift+Enterで改行
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  // テキストエリアの自動リサイズ
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      // 自動リサイズ
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    },
    []
  );

  const positionClasses =
    position === "bottom-right" ? "right-4 bottom-4" : "left-4 bottom-4";

  return (
    <div
      ref={containerRef}
      className={`fixed ${positionClasses} z-[9999] ${className}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 展開時のチャットパネル */}
      <div
        className={`floating-ai-menu-panel absolute bottom-12 ${
          position === "bottom-right" ? "right-0" : "left-0"
        } w-80 sm:w-96 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden transition-all duration-300 ease-out ${
          isExpanded
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-4 scale-95 pointer-events-none"
        }`}
        role="dialog"
        aria-label={title}
        aria-hidden={!isExpanded}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title="会話をクリア"
                aria-label="会話をクリア"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setExpanded(false)}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              title="最小化"
              aria-label="最小化"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* メッセージエリア */}
        <div
          className="h-72 overflow-y-auto p-4 bg-zinc-50 dark:bg-zinc-900/50 scrollbar-thin"
          role="list"
          aria-label="チャット履歴"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
              <MessageCircle className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm text-center">
                AIに質問してみましょう
                <br />
                <span className="text-xs">
                  タスク管理や学習計画について
                  <br />
                  何でもお気軽にどうぞ
                </span>
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading && (
                <div className="flex justify-start mb-3">
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        考え中...
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-900/30 border-t border-red-100 dark:border-red-800">
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs">{error}</p>
                {error.includes("APIキーが設定されていません") && (
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <Settings className="w-3 h-3" />
                    設定画面でAPIキーを設定する
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 入力エリア */}
        <div className="p-3 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px] max-h-[120px]"
              rows={1}
              aria-label="メッセージを入力"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="flex-shrink-0 p-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="送信"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-2 text-center">
            Enter で送信 • Shift+Enter で改行
          </p>
        </div>
      </div>

      {/* フローティングボタン */}
      <button
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        className={`floating-ai-menu-button group relative w-10 h-10 rounded-full shadow-lg transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          isExpanded
            ? "bg-zinc-700 hover:bg-zinc-800 rotate-0"
            : "bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 hover:scale-110"
        }`}
        aria-label={isExpanded ? "閉じる" : "AIアシスタントを開く"}
        aria-expanded={isExpanded}
      >
        <span
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
            isExpanded ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
          }`}
        >
          <ChevronDown className="w-5 h-5 text-white" />
        </span>
        <span
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
            isExpanded ? "opacity-0 -rotate-90" : "opacity-100 rotate-0"
          }`}
        >
          <Sparkles className="w-5 h-5 text-white" />
        </span>

        {/* ツールチップ */}
        {!isExpanded && (
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            AIに質問する
          </span>
        )}
      </button>
    </div>
  );
}
