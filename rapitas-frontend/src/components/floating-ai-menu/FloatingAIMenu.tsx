"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
  memo,
  MouseEvent as ReactMouseEvent,
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
  GripVertical,
} from "lucide-react";
import { useAIChat } from "./useAIChat";
import { fetchConfiguredProviders, fetchAvailableModels } from "./aiService";
import Link from "next/link";
import type { AIChatMessage, ApiProvider } from "@/types";
import { isTauri, isSplitViewActive } from "@/utils/tauri";
import { useFloatingAIMenuStore } from "@/stores/floatingAIMenuStore";

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

type FloatingAIMenuProps = {
  systemPrompt?: string;
  placeholder?: string;
  title?: string;
  position?: "bottom-right" | "bottom-left";
  className?: string;
  style?: React.CSSProperties;
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
        <p className="text-sm whitespace-pre-wrap wrap-break-words leading-relaxed">
          {message.content}
        </p>
        <span
          className={`text-[10px] mt-1 block ${
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
});

type ModelOption = { value: string; label: string };

export default function FloatingAIMenu({
  systemPrompt = "あなたはRapi+アプリケーションのAIアシスタントです。ユーザーのタスク管理や学習に関する質問に日本語で丁寧に回答してください。",
  placeholder = "AIに質問する...",
  title = "AIアシスタント",
  position = "bottom-right",
  className = "",
  style,
}: FloatingAIMenuProps) {
  const [inputValue, setInputValue] = useState("");
  const [isHovering, setIsHovering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ドラッグ関連の状態
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ストアから位置情報を取得
  const { position: storedPosition, updatePosition, resetPosition } = useFloatingAIMenuStore();

  // プロバイダー/モデル選択
  const [selectedProvider, setSelectedProvider] = useState<ApiProvider>("claude");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [configuredProviders, setConfiguredProviders] = useState<ApiProvider[]>([]);
  const [availableModels, setAvailableModels] = useState<Record<string, ModelOption[]>>({});

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
    provider: selectedProvider,
    model: selectedModel || undefined,
  });

  // AIメニューの有効状態を取得
  const { isEnabled, enable } = useFloatingAIMenuStore();

  // 設定済みプロバイダーとモデル一覧を取得
  useEffect(() => {
    fetchConfiguredProviders().then((providers) => {
      setConfiguredProviders(providers);
      if (providers.length > 0 && !providers.includes(selectedProvider)) {
        setSelectedProvider(providers[0]);
      }
    });
    fetchAvailableModels().then(setAvailableModels);
  }, []);

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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded, setExpanded]);

  // Ctrl+Eでトグルするイベント（別のuseEffectで管理）
  useEffect(() => {
    function handleToggleAI() {
      console.log("toggleFloatingAI event received"); // デバッグログ

      // AIメニューが無効な場合は有効にしてから展開
      if (!isEnabled) {
        enable();
        // 状態更新後に展開
        setTimeout(() => {
          setExpanded(true);
        }, 50);
      } else {
        // 既に有効な場合は展開状態をトグル
        toggleExpanded();
      }
    }

    window.addEventListener("toggleFloatingAI", handleToggleAI);
    return () => {
      window.removeEventListener("toggleFloatingAI", handleToggleAI);
    };
  }, [toggleExpanded, isEnabled, enable, setExpanded]);

  // 分割表示状態を監視
  useEffect(() => {
    if (!isTauri()) return;

    // 初期状態をチェック
    setIsSplitView(isSplitViewActive());

    // 分割表示の状態変更を検知するための高頻度チェック
    let rapidCheckCount = 0;
    let rapidCheckInterval: NodeJS.Timeout | null = null;

    // 高頻度チェックを開始する関数
    const startRapidCheck = () => {
      if (rapidCheckInterval) clearInterval(rapidCheckInterval);
      rapidCheckCount = 0;

      rapidCheckInterval = setInterval(() => {
        const isActive = isSplitViewActive();
        const prevState = isSplitView;
        setIsSplitView(isActive);

        // 状態が変化した場合、即座にDOMを更新
        if (isActive !== prevState && containerRef.current) {
          // CSSトランジションを一時的に無効化して即座に移動
          containerRef.current.style.transition = 'none';
          containerRef.current.style.transform = 'translateX(0)';
          void containerRef.current.offsetHeight; // リフローを強制

          // 少し後にトランジションを再有効化
          setTimeout(() => {
            if (containerRef.current) {
              containerRef.current.style.transition = '';
            }
          }, 50);
        }

        rapidCheckCount++;
        // 10回チェック（500ms）したら通常の間隔に戻る
        if (rapidCheckCount >= 10 && rapidCheckInterval) {
          clearInterval(rapidCheckInterval);
          rapidCheckInterval = null;
        }
      }, 50); // 50ms間隔で高頻度チェック
    };

    // 通常のチェック間隔
    const checkInterval = setInterval(() => {
      const isActive = isSplitViewActive();
      if (isActive !== isSplitView) {
        setIsSplitView(isActive);
        // 状態変化を検出したら高頻度チェックを開始
        startRapidCheck();
      }
    }, 500); // 通常は500ms間隔

    // ウィンドウリサイズイベントを監視
    const handleResize = () => {
      // リサイズ時は即座に高頻度チェックを開始
      startRapidCheck();

      // 即座に状態をチェック
      const isActive = isSplitViewActive();
      setIsSplitView(isActive);
    };

    // クリックイベントを監視（外部リンククリック時の検知用）
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // リンククリックを検知
      if (target.tagName === 'A' || target.closest('a')) {
        // 高頻度チェックを開始
        startRapidCheck();
      }
    };

    // カスタムイベントを監視（分割表示の開始・終了を即座に検知）
    const handleSplitViewEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const isActive = customEvent.detail?.active ?? false;
      setIsSplitView(isActive);

      // 即座に位置を更新
      if (containerRef.current) {
        containerRef.current.style.transition = 'none';
        void containerRef.current.offsetHeight; // リフローを強制
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.style.transition = '';
          }
        }, 50);
      }
    };

    // 分割表示準備イベントを監視（分割表示開始前に位置調整）
    const handleSplitViewPreparing = () => {
      // 高頻度チェックを即座に開始
      startRapidCheck();
    };

    window.addEventListener("resize", handleResize);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("rapitas:split-view-activated", handleSplitViewEvent);
    window.addEventListener("rapitas:split-view-preparing", handleSplitViewPreparing);

    return () => {
      clearInterval(checkInterval);
      if (rapidCheckInterval) clearInterval(rapidCheckInterval);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("rapitas:split-view-activated", handleSplitViewEvent);
      window.removeEventListener("rapitas:split-view-preparing", handleSplitViewPreparing);
    };
  }, [isSplitView]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue;
    setInputValue("");
    await sendMessage(message);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    },
    [],
  );

  // ドラッグイベントハンドラー
  const dragStartPos = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);

  const handleMouseDown = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    // 左クリックのみドラッグを開始
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation(); // クリックイベントの伝播を停止
    setIsDragging(true);
    hasDragged.current = false;

    // ドラッグ開始位置を記録
    dragStartPos.current = { x: e.clientX, y: e.clientY };

    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // ボタンの中心からのオフセットを計算
      setDragOffset({
        x: e.clientX - (rect.left + rect.width / 2),
        y: e.clientY - (rect.top + rect.height / 2),
      });
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    let animationFrameId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !buttonRef.current) return;

      // 前のアニメーションフレームをキャンセル
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      // requestAnimationFrameを使用して描画を最適化
      animationFrameId = requestAnimationFrame(() => {
        // ドラッグ距離をチェック（5px以上動いたらドラッグとみなす）
        const dragDistance = Math.sqrt(
          Math.pow(e.clientX - dragStartPos.current.x, 2) +
          Math.pow(e.clientY - dragStartPos.current.y, 2)
        );
        if (dragDistance > 5) {
          hasDragged.current = true;
        }

        // 画面サイズを取得
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // ボタンサイズを取得
        const buttonWidth = 40; // w-10 = 40px
        const buttonHeight = 40; // h-10 = 40px

        // マウス位置からボタン中心の位置を計算（オフセットを考慮）
        const centerX = e.clientX - dragOffset.x;
        const centerY = e.clientY - dragOffset.y;

        // 右下からの距離を計算
        let newRight = viewportWidth - centerX;
        let newBottom = viewportHeight - centerY;

        // 画面外に出ないように制限（ボタンの半分程度は画面外に出せるように）
        const minMargin = buttonWidth / 2;
        newRight = Math.max(-minMargin, Math.min(viewportWidth - minMargin, newRight));
        newBottom = Math.max(-minMargin, Math.min(viewportHeight - minMargin, newBottom));

        // 位置を更新
        updatePosition({ right: newRight, bottom: newBottom });
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      // ドラッグが終了
      if (isDragging) {
        setIsDragging(false);

        // ドラッグしていた場合は、少しの間クリックを無視する
        if (hasDragged.current) {
          setTimeout(() => {
            hasDragged.current = false;
          }, 100);
        }
      }
    };

    // グローバルにイベントリスナーを追加
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      // クリーンアップ時にアニメーションフレームをキャンセル
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, updatePosition]);

  // ダブルクリックで位置をリセット
  const handleDoubleClick = useCallback(() => {
    resetPosition();
  }, [resetPosition]);

  const currentModels = availableModels[selectedProvider] || [];

  return (
    <div
      ref={containerRef}
      className={`fixed z-9999 ${className}`}
      style={{
        // 位置を動的に設定
        right: `${storedPosition.right}px`,
        bottom: `${storedPosition.bottom}px`,
        // ドラッグ中はトランジションを完全に無効化
        transition: isDragging ? 'none !important' : undefined,
        // will-changeは使用しない（残像の原因になるため）
        willChange: 'auto',
        // GPUアクセラレーションを使用
        transform: 'translateZ(0)',
        // アイコンの重なりを防ぐ
        isolation: 'isolate',
        // 外部からのスタイルを適用
        ...style,
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 展開時のチャットパネル */}
      <div
        className={`floating-ai-menu-panel absolute bottom-12 right-0 w-80 sm:w-96 bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden ${
          isExpanded
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-4 scale-95 pointer-events-none"
        }`}
        style={{
          // パネルのトランジションを最適化
          transition: isExpanded
            ? 'opacity 300ms ease-out, transform 300ms ease-out'
            : 'opacity 200ms ease-in, transform 200ms ease-in',
          // will-changeはアニメーション中のみ設定
          willChange: isExpanded ? 'opacity, transform' : 'auto',
          // GPUアクセラレーションを使用
          transform: isExpanded ? 'translateY(0) translateZ(0)' : 'translateY(4px) translateZ(0)',
        }}
        role="dialog"
        aria-label={title}
        aria-hidden={!isExpanded}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 bg-linear-to-r from-blue-500 to-indigo-600 text-white">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold text-sm">{title}</span>
            {configuredProviders.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-white/20 rounded-full">
                {PROVIDER_LABELS[selectedProvider]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-lg transition-colors ${showSettings ? "bg-white/30" : "hover:bg-white/20"}`}
              title="AI設定"
              aria-label="AI設定"
            >
              <Settings className="w-4 h-4" />
            </button>
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

        {/* プロバイダー/モデル選択パネル */}
        {showSettings && (
          <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700 space-y-3">
            {/* プロバイダー選択 */}
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
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
                          ? "bg-violet-600 text-white shadow-sm"
                          : isConfigured
                          ? "bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-violet-50 dark:hover:bg-zinc-600 border border-zinc-200 dark:border-zinc-600"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed border border-zinc-100 dark:border-zinc-800"
                      }`}
                      title={isConfigured ? PROVIDER_LABELS[p] : `${PROVIDER_LABELS[p]}（未設定）`}
                    >
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${isConfigured ? PROVIDER_COLORS[p] : "bg-zinc-300 dark:bg-zinc-600"}`} />
                      {PROVIDER_LABELS[p]}
                    </button>
                  );
                })}
              </div>
              {configuredProviders.length === 0 && (
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1 mt-2 text-[11px] text-violet-500 hover:text-violet-600 dark:text-violet-400"
                >
                  <Settings className="w-3 h-3" />
                  設定画面でAPIキーを登録
                </Link>
              )}
            </div>

            {/* モデル選択 */}
            {currentModels.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                  モデル
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full appearance-none px-3 py-1.5 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
        <div
          className="h-72 overflow-y-auto p-4 bg-zinc-50 dark:bg-indigo-dark-900/50 scrollbar-thin"
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
                  タスク管理や学習について
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
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs">{error}</p>
                {(error.includes("APIキーが設定されていません") || error.includes("APIキーが無効です")) && (
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
        <div className="p-3 bg-white dark:bg-indigo-dark-900 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-10 max-h-[120px]"
              rows={1}
              aria-label="メッセージを入力"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="shrink-0 p-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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
            Enter で送信 ・ Shift+Enter で改行
          </p>
        </div>
      </div>

      {/* フローティングボタン */}
      <button
        ref={buttonRef}
        onMouseDown={handleMouseDown}
        onMouseUp={(e) => {
          // ドラッグしていない場合はクリックとして処理
          if (!hasDragged.current && isDragging) {
            setIsDragging(false);
            toggleExpanded();
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleDoubleClick();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        className={`floating-ai-menu-button group relative w-10 h-10 rounded-full shadow-lg ${isDragging ? '' : 'transition-all duration-300 ease-out'} focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          isExpanded
            ? "bg-zinc-700 hover:bg-zinc-800 rotate-0"
            : "bg-linear-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
        } ${isDragging ? 'cursor-grabbing scale-110' : 'cursor-grab hover:scale-110'}`}
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
        {!isExpanded && !isDragging && (
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            AIに質問する（ドラッグで移動）
          </span>
        )}

        {/* ドラッグ中のインジケーター */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center">
            <GripVertical className="w-5 h-5 text-white opacity-50" />
          </div>
        )}
      </button>
    </div>
  );
}
