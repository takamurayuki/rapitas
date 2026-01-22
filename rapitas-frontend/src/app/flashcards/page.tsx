"use client";
import { useEffect, useState } from "react";
import type { FlashcardDeck, Flashcard } from "@/types";
import {
  Plus,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Brain,
  Check,
  X,
  Layers,
} from "lucide-react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function FlashcardsPage() {
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<FlashcardDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isStudyMode, setIsStudyMode] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckColor, setDeckColor] = useState("#3B82F6");
  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");

  useEffect(() => {
    fetchDecks();
  }, []);

  const fetchDecks = async () => {
    try {
      const res = await fetch(`${API_BASE}/flashcard-decks`);
      if (res.ok) {
        setDecks(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch decks:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeck = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/flashcard-decks/${id}`);
      if (res.ok) {
        setSelectedDeck(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch deck:", e);
    }
  };

  const handleCreateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deckName.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/flashcard-decks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deckName, color: deckColor }),
      });
      if (res.ok) {
        fetchDecks();
        setIsCreateModalOpen(false);
        setDeckName("");
      }
    } catch (e) {
      console.error("Failed to create deck:", e);
    }
  };

  const handleDeleteDeck = async (id: number) => {
    if (!confirm("このデッキを削除しますか？")) return;
    try {
      const res = await fetch(`${API_BASE}/flashcard-decks/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchDecks();
        if (selectedDeck?.id === id) {
          setSelectedDeck(null);
        }
      }
    } catch (e) {
      console.error("Failed to delete deck:", e);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardFront.trim() || !cardBack.trim() || !selectedDeck) return;

    try {
      const res = await fetch(`${API_BASE}/flashcard-decks/${selectedDeck.id}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: cardFront, back: cardBack }),
      });
      if (res.ok) {
        fetchDeck(selectedDeck.id);
        setIsCardModalOpen(false);
        setCardFront("");
        setCardBack("");
      }
    } catch (e) {
      console.error("Failed to add card:", e);
    }
  };

  const handleDeleteCard = async (cardId: number) => {
    if (!confirm("このカードを削除しますか？")) return;
    try {
      const res = await fetch(`${API_BASE}/flashcards/${cardId}`, {
        method: "DELETE",
      });
      if (res.ok && selectedDeck) {
        fetchDeck(selectedDeck.id);
      }
    } catch (e) {
      console.error("Failed to delete card:", e);
    }
  };

  const handleReview = async (quality: number) => {
    if (!selectedDeck?.cards?.[currentCardIndex]) return;

    const card = selectedDeck.cards[currentCardIndex];
    try {
      await fetch(`${API_BASE}/flashcards/${card.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality }),
      });

      // 次のカードへ
      if (currentCardIndex < (selectedDeck.cards?.length || 0) - 1) {
        setCurrentCardIndex(currentCardIndex + 1);
        setIsFlipped(false);
      } else {
        // 復習完了
        setIsStudyMode(false);
        setCurrentCardIndex(0);
        fetchDeck(selectedDeck.id);
      }
    } catch (e) {
      console.error("Failed to review card:", e);
    }
  };

  const startStudy = () => {
    if (!selectedDeck?.cards?.length) return;
    setCurrentCardIndex(0);
    setIsFlipped(false);
    setIsStudyMode(true);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 学習モード
  if (isStudyMode && selectedDeck?.cards) {
    const card = selectedDeck.cards[currentCardIndex];
    if (!card) return null;

    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => {
              setIsStudyMode(false);
              setCurrentCardIndex(0);
            }}
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="w-5 h-5" />
            戻る
          </button>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {currentCardIndex + 1} / {selectedDeck.cards.length}
          </span>
        </div>

        {/* カード */}
        <div
          onClick={() => setIsFlipped(!isFlipped)}
          className="aspect-[3/2] bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center p-8 cursor-pointer transition-all hover:shadow-2xl"
        >
          <div className="text-center">
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">
              {isFlipped ? "答え" : "問題"}
            </p>
            <p className="text-2xl font-medium text-zinc-900 dark:text-zinc-50">
              {isFlipped ? card.back : card.front}
            </p>
            {!isFlipped && (
              <p className="mt-6 text-sm text-zinc-400 dark:text-zinc-500">
                タップして答えを見る
              </p>
            )}
          </div>
        </div>

        {/* 評価ボタン */}
        {isFlipped && (
          <div className="mt-6 grid grid-cols-4 gap-3">
            <button
              onClick={() => handleReview(1)}
              className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
            >
              <X className="w-5 h-5 mx-auto mb-1" />
              <span className="text-xs">忘れた</span>
            </button>
            <button
              onClick={() => handleReview(3)}
              className="p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-xl hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
            >
              <RotateCcw className="w-5 h-5 mx-auto mb-1" />
              <span className="text-xs">難しい</span>
            </button>
            <button
              onClick={() => handleReview(4)}
              className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-xl hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              <Check className="w-5 h-5 mx-auto mb-1" />
              <span className="text-xs">覚えた</span>
            </button>
            <button
              onClick={() => handleReview(5)}
              className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-xl hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
            >
              <Brain className="w-5 h-5 mx-auto mb-1" />
              <span className="text-xs">完璧</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // デッキ詳細
  if (selectedDeck) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedDeck(null)}
              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${selectedDeck.color}20`, color: selectedDeck.color }}
            >
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                {selectedDeck.name}
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {selectedDeck.cards?.length || 0} 枚のカード
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsCardModalOpen(true)}
              className="flex items-center gap-2 px-3 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <Plus className="w-4 h-4" />
              カード追加
            </button>
            {(selectedDeck.cards?.length || 0) > 0 && (
              <button
                onClick={startStudy}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Brain className="w-4 h-4" />
                学習開始
              </button>
            )}
          </div>
        </div>

        {/* カードリスト */}
        <div className="space-y-3">
          {selectedDeck.cards?.map((card, index) => (
            <div
              key={card.id}
              className="flex items-center gap-4 p-4 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700"
            >
              <span className="w-8 h-8 bg-zinc-100 dark:bg-zinc-700 rounded-full flex items-center justify-center text-sm font-medium text-zinc-600 dark:text-zinc-400">
                {index + 1}
              </span>
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">問題</p>
                  <p className="text-zinc-900 dark:text-zinc-100">{card.front}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">答え</p>
                  <p className="text-zinc-900 dark:text-zinc-100">{card.back}</p>
                </div>
              </div>
              <button
                onClick={() => handleDeleteCard(card.id)}
                className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {(!selectedDeck.cards || selectedDeck.cards.length === 0) && (
          <div className="text-center py-12">
            <Layers className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400 mb-4">
              カードがありません
            </p>
            <button
              onClick={() => setIsCardModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              カードを追加
            </button>
          </div>
        )}

        {/* カード追加モーダル */}
        {isCardModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md p-6">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
                カードを追加
              </h2>
              <form onSubmit={handleAddCard} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    問題（表面）
                  </label>
                  <textarea
                    value={cardFront}
                    onChange={(e) => setCardFront(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    答え（裏面）
                  </label>
                  <textarea
                    value={cardBack}
                    onChange={(e) => setCardBack(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                    required
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCardModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg"
                  >
                    追加
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // デッキ一覧
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              フラッシュカード
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              忘却曲線に基づく効率的な暗記学習
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          新規デッキ
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {decks.map((deck) => (
          <div
            key={deck.id}
            onClick={() => fetchDeck(deck.id)}
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 cursor-pointer hover:shadow-lg transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${deck.color}20`, color: deck.color }}
              >
                <Layers className="w-6 h-6" />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteDeck(deck.id);
                }}
                className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
              {deck.name}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {deck._count?.cards || 0} 枚
            </p>
          </div>
        ))}
      </div>

      {decks.length === 0 && (
        <div className="text-center py-12">
          <Brain className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">
            デッキがありません
          </p>
        </div>
      )}

      {/* デッキ作成モーダル */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
              新しいデッキ
            </h2>
            <form onSubmit={handleCreateDeck} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  デッキ名
                </label>
                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  placeholder="例: 英単語、歴史年号"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg"
                >
                  作成
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
