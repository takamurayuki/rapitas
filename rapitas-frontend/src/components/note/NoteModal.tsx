"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  Minus,
  Plus,
  FileText,
  StickyNote,
  Send,
  Loader2,
  Trash2,
  Settings,
  AlertCircle,
  MessageCircle,
  Sparkles,
  Search,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useNoteStore, type ModalTab } from "@/stores/noteStore";
import NoteEditor from "./NoteEditor";
import NoteSidebar from "./NoteSidebar";
import { useAIChat } from "../floating-ai-menu/useAIChat";
import {
  fetchConfiguredProviders,
  fetchAvailableModels,
} from "../floating-ai-menu/aiService";
import Link from "next/link";
import type { AIChatMessage, ApiProvider } from "@/types";

const ICON_SIZE = 32;

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};

const PROVIDER_COLORS: Record<ApiProvider, string> = {
  claude: "bg-orange-500",
  chatgpt: "bg-green-500",
  gemini: "bg-blue-500",
};

function ChatMessage({ message }: { message: AIChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          isUser
            ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-br-md"
            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {message.content}
        </p>
        <span
          className={`text-xs mt-1 block ${
            isUser ? "text-blue-100" : "text-zinc-400 dark:text-zinc-500"
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
}

function AITabContent() {
  const [inputValue, setInputValue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [selectedProvider, setSelectedProvider] =
    useState<ApiProvider>("claude");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [configuredProviders, setConfiguredProviders] = useState<ApiProvider[]>(
    []
  );
  const [availableModels, setAvailableModels] = useState<
    Record<string, { value: string; label: string }[]>
  >({});

  const { messages, isLoading, error, sendMessage, clearMessages } = useAIChat({
    systemPrompt:
      "あなたはRapi+アプリケーションのAIアシスタントです。ユーザーのタスク管理、学習、開発作業に関する質問に日本語で丁寧に回答してください。",
    provider: selectedProvider,
    model: selectedModel || undefined,
  });

  useEffect(() => {
    fetchConfiguredProviders().then((providers) => {
      setConfiguredProviders(providers);
      if (providers.length > 0 && !providers.includes(selectedProvider)) {
        setSelectedProvider(providers[0]);
      }
    });
    fetchAvailableModels().then(setAvailableModels);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;
    const message = inputValue;
    setInputValue("");
    await sendMessage(message);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    },
    []
  );

  const currentModels = availableModels[selectedProvider] || [];

  return (
    <div className="flex flex-col h-full">
      {/* AI設定バー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          {configuredProviders.length > 0 && (
            <span className="px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {PROVIDER_LABELS[selectedProvider]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition-colors ${
              showSettings
                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
            title="AI設定"
          >
            <Settings className="w-4 h-4" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              title="会話をクリア"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* プロバイダー/モデル選択 */}
      {showSettings && (
        <div className="px-3 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              AIプロバイダー
            </label>
            <div className="flex gap-1.5">
              {(["claude", "chatgpt", "gemini"] as ApiProvider[]).map((p) => {
                const isConfigured = configuredProviders.includes(p);
                const isSelected = selectedProvider === p;
                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (isConfigured) {
                        setSelectedProvider(p);
                        setSelectedModel("");
                      }
                    }}
                    disabled={!isConfigured}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white"
                        : isConfigured
                        ? "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-600"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                        isConfigured
                          ? PROVIDER_COLORS[p]
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    />
                    {PROVIDER_LABELS[p]}
                  </button>
                );
              })}
            </div>
            {configuredProviders.length === 0 && (
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
              >
                <Settings className="w-3 h-3" />
                設定画面でAPIキーを登録
              </Link>
            )}
          </div>
          {currentModels.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                モデル
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-2 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">デフォルト</option>
                {currentModels.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="p-3 bg-zinc-100 dark:bg-zinc-700 rounded-full mb-3">
              <MessageCircle className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
            </div>
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              AIアシスタント
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
              タスク管理、学習計画、コーディングの質問など、
              <br />
              あなたの作業をサポートします。
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex justify-start mb-3">
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
        <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-red-50 dark:bg-red-900/30">
          <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* 入力エリア */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-700">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            disabled={isLoading}
            className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px] max-h-[120px]"
            rows={1}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-zinc-300 disabled:to-zinc-300 dark:disabled:from-zinc-700 dark:disabled:to-zinc-700 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 text-center">
          Enter で送信・Shift+Enter で改行
        </p>
      </div>
    </div>
  );
}

/** ドラッグ/リサイズ中に背景を覆い、マウスイベントを奪うオーバーレイ */
function DragOverlay({ cursor }: { cursor: string }) {
  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: 99999, cursor }}
    />
  );
}

export default function NoteModal() {
  const {
    modalState,
    notes,
    currentNoteId,
    searchQuery,
    closeModal,
    toggleMinimize,
    toggleMaximize,
    setModalPosition,
    setModalSize,
    bringToFront,
    createNote,
    setModalTab,
    setSearchQuery,
  } = useNoteStore();

  const modalRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragPending, setIsDragPending] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const sidebarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const currentNote = notes.find((note) => note.id === currentNoteId);
  const activeTab = modalState.activeTab;

  const handleSidebarEnter = () => {
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    sidebarTimerRef.current = setTimeout(() => setIsSidebarHovered(true), 150);
  };
  const handleSidebarLeave = () => {
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    sidebarTimerRef.current = setTimeout(() => setIsSidebarHovered(false), 200);
  };

  // --- ドラッグ ---
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const DRAG_THRESHOLD = 3; // px — この距離を超えて初めてドラッグ開始

  const handleDragStart = (e: React.MouseEvent) => {
    // ボタンクリックを除外
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    didDragRef.current = false;
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
    dragStartRef.current = {
      x: e.clientX - modalState.position.x,
      y: e.clientY - modalState.position.y,
    };
    setIsDragPending(true);
    bringToFront();
  };

  useEffect(() => {
    if (!isDragging && !isDragPending) return;

    const onMove = (e: MouseEvent) => {
      if (isDragPending && !isDragging) {
        // しきい値を超えたら実際にドラッグ開始（DragOverlay表示）
        const dx = e.clientX - dragOriginRef.current.x;
        const dy = e.clientY - dragOriginRef.current.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          didDragRef.current = true;
          setIsDragPending(false);
          setIsDragging(true);
        }
        return;
      }
      didDragRef.current = true;
      setModalPosition(
        e.clientX - dragStartRef.current.x,
        e.clientY - dragStartRef.current.y
      );
    };
    const onUp = () => {
      setIsDragPending(false);
      setIsDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, isDragPending, setModalPosition]);

  // --- リサイズ ---
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: modalState.size.width,
      height: modalState.size.height,
    };
    bringToFront();
  };

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const s = resizeStartRef.current;
      setModalSize(
        Math.max(400, s.width + e.clientX - s.x),
        Math.max(300, s.height + e.clientY - s.y)
      );
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing, setModalSize]);

  // ショートカットキー
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeModal]);

  const handleTabChange = (tab: ModalTab) => {
    setModalTab(tab);
    if (tab === "note" && notes.length === 0) {
      createNote();
    }
  };

  if (!modalState.isOpen) return null;

  // ─── 最小化時：アイコン表示 ───
  if (modalState.isMinimized) {
    return (
      <>
        {isDragging && <DragOverlay cursor="move" />}
        <div
          className="fixed cursor-move select-none"
          style={{
            left: `${modalState.position.x}px`,
            top: `${modalState.position.y}px`,
            width: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
            zIndex: modalState.zIndex,
          }}
          onMouseDown={handleDragStart}
          onClick={() => { if (!didDragRef.current) toggleMinimize(); }}
          title="クリックで復元"
        >
          <div className="w-full h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 shadow-lg hover:shadow-xl flex items-center justify-center transition-shadow">
            {activeTab === "note" ? (
              <StickyNote className="w-4 h-4 text-white" />
            ) : (
              <Sparkles className="w-4 h-4 text-white" />
            )}
          </div>
        </div>
      </>
    );
  }

  // ─── 通常表示 ───
  return (
    <>
      {(isDragging || isResizing) && (
        <DragOverlay cursor={isDragging ? "move" : "se-resize"} />
      )}
      <div
        ref={modalRef}
        className={`fixed bg-white dark:bg-zinc-900 overflow-hidden note-modal-enter ${
          modalState.isMaximized
            ? "rounded-none"
            : "rounded-xl shadow-2xl"
        }`}
        style={
          modalState.isMaximized
            ? {
                left: 0,
                top: 64,
                width: "100vw",
                height: "calc(100vh - 64px)",
                zIndex: modalState.zIndex,
              }
            : {
                left: `${modalState.position.x}px`,
                top: `${modalState.position.y}px`,
                width: `${modalState.size.width}px`,
                height: `${modalState.size.height}px`,
                zIndex: modalState.zIndex,
                boxShadow:
                  "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              }
        }
      >
        {/* ヘッダー */}
        <div
          className={`h-12 bg-gradient-to-r from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 flex items-center justify-between px-3 select-none ${
            modalState.isMaximized ? "cursor-default" : "cursor-move"
          }`}
          onMouseDown={modalState.isMaximized ? undefined : handleDragStart}
        >
          <div className="flex items-center bg-white/15 rounded-md p-0.5">
            <button
              onClick={() => handleTabChange("note")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all select-none ${
                activeTab === "note"
                  ? "bg-white/25 text-white shadow-sm"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <StickyNote className="w-3.5 h-3.5" />
              <span>ノート</span>
            </button>
            <button
              onClick={() => handleTabChange("ai")}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all select-none ${
                activeTab === "ai"
                  ? "bg-white/25 text-white shadow-sm"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI</span>
            </button>
          </div>
          <div className="flex items-center gap-1">
            {/* ノートタブ時のみ検索 */}
            {activeTab === "note" && (
              <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="検索..."
                  className="w-32 focus:w-44 transition-all pl-7 pr-2 py-1 bg-white/15 hover:bg-white/20 focus:bg-white/25 text-white placeholder:text-white/50 text-sm rounded-lg border border-white/10 focus:border-white/30 focus:outline-none"
                />
              </div>
            )}
            <button
              onClick={toggleMinimize}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="最小化"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={toggleMaximize}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title={modalState.isMaximized ? "元のサイズに戻す" : "全画面表示"}
            >
              {modalState.isMaximized ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={closeModal}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="h-[calc(100%-48px)]">
          {activeTab === "note" ? (
            <div className="relative flex h-full">
              {/* ホバー展開サイドバー */}
              <div
                className="absolute left-0 top-0 h-full z-10"
                onMouseEnter={handleSidebarEnter}
                onMouseLeave={handleSidebarLeave}
              >
                {/* ホバートリガー（常に表示される細い帯） */}
                <div
                  className={`h-full flex items-center transition-all duration-200 ${
                    isSidebarHovered ? "w-0 opacity-0" : "w-6 opacity-100"
                  }`}
                >
                  <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer">
                    <PanelLeftOpen className="w-3.5 h-3.5 text-zinc-400" />
                  </div>
                </div>
                {/* 展開されるサイドバー */}
                <div
                  className={`absolute left-0 top-0 h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700 shadow-xl transition-all duration-200 overflow-hidden ${
                    isSidebarHovered ? "w-64 opacity-100" : "w-0 opacity-0"
                  }`}
                >
                  <div className="w-64 h-full">
                    <NoteSidebar />
                  </div>
                </div>
              </div>
              {/* エディター */}
              <div className="flex-1 pl-6">
                {currentNote ? (
                  <NoteEditor note={currentNote} />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <FileText className="w-16 h-16 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
                      <p className="text-zinc-500 dark:text-zinc-400 mb-4">
                        ノートを選択するか、新規作成してください
                      </p>
                      <button
                        onClick={createNote}
                        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2 mx-auto"
                      >
                        <Plus className="w-4 h-4" />
                        新規ノート作成
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <AITabContent />
          )}
        </div>

        {/* リサイズハンドル（最大化時は非表示） */}
        {!modalState.isMaximized && (
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute bottom-1 right-1 w-2 h-2 bg-zinc-400 dark:bg-zinc-600 rounded-sm" />
          </div>
        )}
      </div>
    </>
  );
}
