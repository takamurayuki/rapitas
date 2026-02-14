"use client";
import { useState, useRef, useEffect } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Highlighter,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Save,
  Pin,
  Tag,
  Calendar,
  Palette,
  Hash
} from "lucide-react";
import { Note, useNoteStore } from "@/stores/noteStore";
import { useDarkMode } from "@/hooks/use-dark-mode";

interface NoteEditorProps {
  note: Note;
}

const highlightColors = [
  { name: "イエロー", value: "#fef08a" },
  { name: "グリーン", value: "#bbf7d0" },
  { name: "ブルー", value: "#bfdbfe" },
  { name: "ピンク", value: "#fbcfe8" },
  { name: "パープル", value: "#e9d5ff" },
  { name: "オレンジ", value: "#fed7aa" },
];

export default function NoteEditor({ note }: NoteEditorProps) {
  const { updateNote } = useNoteStore();
  const { isDarkMode } = useDarkMode();
  const contentRef = useRef<HTMLDivElement>(null);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // タイトル変更
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNote(note.id, { title: e.target.value });
    autoSave();
  };

  // コンテンツ変更
  const handleContentChange = () => {
    if (contentRef.current) {
      updateNote(note.id, { content: contentRef.current.innerHTML });
      autoSave();
    }
  };

  // 自動保存
  const autoSave = () => {
    setIsSaved(false);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      setIsSaved(true);
    }, 1000);
  };

  // テキストフォーマット適用
  const applyFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    handleContentChange();
  };

  // ハイライト適用
  const applyHighlight = (color: string) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const span = document.createElement("span");
      span.style.backgroundColor = color;
      span.style.padding = "0 2px";
      span.style.borderRadius = "2px";

      try {
        range.surroundContents(span);
        handleContentChange();
      } catch (e) {
        // 複数のノードをまたぐ選択の場合
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
        handleContentChange();
      }
    }
    setShowColorPicker(false);
  };

  // タグ追加
  const addTag = () => {
    if (tagInput.trim() && !note.tags.includes(tagInput.trim())) {
      updateNote(note.id, {
        tags: [...note.tags, tagInput.trim()],
      });
      setTagInput("");
      setShowTagInput(false);
    }
  };

  // タグ削除
  const removeTag = (tag: string) => {
    updateNote(note.id, {
      tags: note.tags.filter((t) => t !== tag),
    });
  };

  // 選択テキスト取得
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection) {
      setSelectedText(selection.toString());
    }
  };

  // ノート切り替え時にコンテンツを更新
  useEffect(() => {
    if (contentRef.current && note.content !== contentRef.current.innerHTML) {
      contentRef.current.innerHTML = note.content;
    }
  }, [note.id]);

  return (
    <div className="flex flex-col h-full">
      {/* ツールバー */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-1">
          <button
            onClick={() => applyFormat("bold")}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="太字"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyFormat("italic")}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="斜体"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyFormat("underline")}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="下線"
          >
            <Underline className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
          <button
            onClick={() => applyFormat("insertUnorderedList")}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="箇条書き"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyFormat("insertOrderedList")}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="番号付きリスト"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="ハイライト"
            >
              <Highlighter className="w-4 h-4" />
            </button>
            {showColorPicker && (
              <div className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10">
                <div className="grid grid-cols-3 gap-1">
                  {highlightColors.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => applyHighlight(color.value)}
                      className="w-8 h-8 rounded border-2 border-zinc-300 dark:border-zinc-600 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color.value }}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateNote(note.id, { isPinned: !note.isPinned })}
            className={`p-2 rounded-lg transition-colors ${
              note.isPinned
                ? "text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
            title={note.isPinned ? "ピンを外す" : "ピン留め"}
          >
            <Pin className="w-4 h-4" />
          </button>
          <div className={`flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 ${isSaved ? "save-indicator-enter" : ""}`}>
            <Save className={`w-4 h-4 ${isSaved ? "text-green-500" : ""}`} />
            <span>{isSaved ? "保存済み" : "保存中..."}</span>
          </div>
        </div>
      </div>

      {/* タイトル */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
        <input
          type="text"
          value={note.title}
          onChange={handleTitleChange}
          className="w-full text-2xl font-bold bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          placeholder="タイトルを入力..."
        />

        {/* タグ */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-md text-sm note-tag"
            >
              <Hash className="w-3 h-3" />
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="ml-1 hover:text-indigo-900 dark:hover:text-indigo-100"
              >
                ×
              </button>
            </span>
          ))}
          {showTagInput ? (
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") addTag();
                if (e.key === "Escape") setShowTagInput(false);
              }}
              onBlur={() => {
                if (tagInput) addTag();
                else setShowTagInput(false);
              }}
              className="px-2 py-1 text-sm bg-transparent border-b border-indigo-300 dark:border-indigo-600 outline-none"
              placeholder="タグを入力..."
              autoFocus
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <Tag className="w-3 h-3" />
              タグを追加
            </button>
          )}
        </div>
      </div>

      {/* エディター本体 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div
          ref={contentRef}
          contentEditable
          className="p-4 min-h-full outline-none prose prose-zinc dark:prose-invert max-w-none note-editor"
          dangerouslySetInnerHTML={{ __html: note.content }}
          onInput={handleContentChange}
          onMouseUp={handleTextSelection}
          onKeyUp={handleTextSelection}
          style={{
            lineHeight: "1.8",
            fontSize: "16px",
          }}
        />
      </div>

      {/* フッター */}
      <div className="flex items-center justify-between p-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>作成: {new Date(note.createdAt).toLocaleDateString("ja-JP")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>更新: {new Date(note.updatedAt).toLocaleDateString("ja-JP")}</span>
        </div>
      </div>
    </div>
  );
}