"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useNoteStore } from "@/stores/noteStore";

// 動的インポートでノートモーダルを読み込み（初期レンダリングのパフォーマンス改善）
const NoteModal = dynamic(() => import("./NoteModal"), {
  ssr: false,
});

export default function NoteProvider() {
  const { toggleModal } = useNoteStore();

  // グローバルイベントリスナー（他のコンポーネントからノートモーダルを開けるように）
  useEffect(() => {
    const handleOpenNote = () => toggleModal();
    window.addEventListener("openNoteModal", handleOpenNote);
    return () => window.removeEventListener("openNoteModal", handleOpenNote);
  }, [toggleModal]);

  return <NoteModal />;
}