"use client";
import { Sparkles } from "lucide-react";
import { useNoteStore } from "@/stores/noteStore";

export default function FloatingModeToggle() {
  const { toggleModal, modalState } = useNoteStore();

  // モーダルが開いている間は非表示（最小化アイコンと重複するため）
  if (modalState.isOpen) return null;

  return (
    <button
      onClick={toggleModal}
      className="fixed bottom-6 right-6 z-50 w-8 h-8 rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-110 bg-gradient-to-r from-indigo-500 to-purple-600 text-white"
      title="ノート / AI（Ctrl+E）"
    >
      <Sparkles className="w-4 h-4" />
    </button>
  );
}
