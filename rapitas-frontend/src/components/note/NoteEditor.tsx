"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Highlighter,
  Save,
  Pin,
  Calendar,
  TextQuote,
  Table,
  Link2,
  Loader2,
} from "lucide-react";
import { Note, useNoteStore } from "@/stores/noteStore";
import { API_BASE_URL } from "@/utils/api";

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

const borderLineColors = [
  { name: "グレー", value: "#a1a1aa" },
  { name: "ブルー", value: "#3b82f6" },
  { name: "グリーン", value: "#22c55e" },
  { name: "レッド", value: "#ef4444" },
  { name: "パープル", value: "#a855f7" },
  { name: "オレンジ", value: "#f97316" },
];

const highlightStyles = [
  { name: "全体", top: 0, label: "A" },
  { name: "太マーカー", top: 50, label: "A" },
  { name: "細マーカー", top: 70, label: "A" },
  { name: "下線", top: 85, label: "A" },
] as const;

export default function NoteEditor({ note }: NoteEditorProps) {
  const { updateNote } = useNoteStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBorderPicker, setShowBorderPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isLinkLoading, setIsLinkLoading] = useState(false);
  const [highlightStyleIndex, setHighlightStyleIndex] = useState(1);
  const [isDirty, setIsDirty] = useState(false);
  const savedSelectionRef = useRef<Range | null>(null);

  const normalizeLinkCards = useCallback((root: HTMLElement) => {
    const anchors = Array.from(root.querySelectorAll("a"));

    for (const a of anchors) {
      const anchor = a as HTMLAnchorElement;

      const isKnownCard = anchor.dataset.rapitasLinkCard === "1";
      const looksLikeCard =
        anchor.target === "_blank" &&
        anchor.rel.includes("noopener") &&
        anchor.style.display === "inline-flex" &&
        !!anchor.style.background;

      if (!isKnownCard && !looksLikeCard) continue;

      anchor.dataset.rapitasLinkCard = "1";

      // Tighten vertical metrics so it doesn't look like extra padding.
      anchor.style.lineHeight = "1";
      anchor.style.height = "1.5em";
      anchor.style.verticalAlign = "text-bottom";

      // Some old cards used inherited line-height; ensure no accidental vertical padding.
      if (!anchor.style.padding) {
        anchor.style.padding = "0 2px";
      }

      // Normalize favicon images: avoid inline-image baseline gap and match text height.
      const img = anchor.querySelector("img");
      if (img instanceof HTMLImageElement) {
        img.style.display = "block";
        img.style.width = "13px";
        img.style.height = "13px";
        img.style.objectFit = "cover";
        img.style.alignSelf = "center";
        if (!img.style.borderRadius) img.style.borderRadius = "2px";
        if (!img.style.flexShrink) img.style.flexShrink = "0";
      }
    }
  }, []);

  // ノート切り替え時・初回マウント時にコンテンツをセット
  useEffect(() => {
    setDraftTitle(note.title);
    setIsDirty(false);
    if (contentRef.current) {
      contentRef.current.innerHTML = note.content;
      normalizeLinkCards(contentRef.current);
    }
  }, [note.id]);

  // タイトル変更（ローカルドラフトのみ更新）
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftTitle(e.target.value);
    setIsDirty(true);
  };

  // タイトルペースト時にHTMLタグを除去
  const handleTitlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const target = e.target as HTMLInputElement;
    const start = target.selectionStart || 0;
    const end = target.selectionEnd || 0;
    const newValue =
      target.value.substring(0, start) + text + target.value.substring(end);
    setDraftTitle(newValue);
    setIsDirty(true);
    // カーソル位置を調整
    setTimeout(() => {
      target.selectionStart = target.selectionEnd = start + text.length;
    }, 0);
  };

  // コンテンツ変更（ダーティフラグのみ）
  const handleContentChange = () => {
    setIsDirty(true);
  };

  // 手動保存
  const handleSave = useCallback(() => {
    if (!isDirty) return;
    const content = contentRef.current?.innerHTML ?? note.content;
    updateNote(note.id, { title: draftTitle, content });
    setIsDirty(false);
  }, [isDirty, draftTitle, note.id, note.content, updateNote]);

  // Ctrl+S で保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  // Enter時にスタイル付きspanから抜ける（ハイライト・縦線共通）
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;

    // カーソル位置の祖先にスタイル付きspanがあるか探す
    let styledSpan: HTMLElement | null = null;
    while (node && node !== contentRef.current) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).tagName === "SPAN"
      ) {
        const el = node as HTMLElement;
        if (
          el.style.backgroundColor ||
          el.style.background ||
          el.style.borderLeft
        ) {
          styledSpan = el;
          break;
        }
      }
      node = node.parentNode;
    }

    if (!styledSpan) return;

    e.preventDefault();

    // カーソル以降のテキストをspanから切り出す
    const afterRange = document.createRange();
    afterRange.setStart(range.startContainer, range.startOffset);
    afterRange.setEndAfter(styledSpan.lastChild || styledSpan);
    const trailing = afterRange.extractContents();

    // 末尾テキストがあれば同スタイルのspanとして残す
    const hasTrailing = trailing.textContent && trailing.textContent.length > 0;
    let trailingSpan: HTMLElement | null = null;
    if (hasTrailing) {
      trailingSpan = styledSpan.cloneNode(false) as HTMLElement;
      trailingSpan.appendChild(trailing);
    }

    // 新しい行を挿入
    const br = document.createElement("br");
    styledSpan.parentNode!.insertBefore(br, styledSpan.nextSibling);

    // 末尾テキストをbrの後に挿入
    if (trailingSpan) {
      br.parentNode!.insertBefore(trailingSpan, br.nextSibling);
    }

    // カーソルをbrの後（スタイル外）に移動
    const newRange = document.createRange();
    if (trailingSpan) {
      newRange.setStart(trailingSpan, 0);
    } else {
      newRange.setStartAfter(br);
    }
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    // 空になったspanを除去
    if (!styledSpan.textContent) {
      styledSpan.remove();
    }

    handleContentChange();
  };

  // テキストフォーマット適用
  const applyFormat = (command: string, value?: string) => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      return;
    }

    // コンテンツエディタにフォーカスがない場合は、フォーカスを移す
    if (!contentRef.current?.contains(activeElement)) {
      contentRef.current?.focus();
    }

    document.execCommand(command, false, value);
    handleContentChange();
  };

  // ハイライト適用
  const applyHighlight = (color: string) => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      setShowColorPicker(false);
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にあることを確認
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        setShowColorPicker(false);
        return;
      }

      const span = document.createElement("span");
      const style = highlightStyles[highlightStyleIndex];

      if (style.top === 0) {
        span.style.backgroundColor = color;
        span.style.padding = "0 2px";
        span.style.borderRadius = "2px";
      } else {
        span.style.background = `linear-gradient(transparent ${style.top}%, ${color} ${style.top}%)`;
        span.style.padding = "0 1px";
      }

      try {
        range.surroundContents(span);
        handleContentChange();
      } catch {
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
        handleContentChange();
      }
    }
    setShowColorPicker(false);
  };

  // 左側縦線を適用
  const applyBorderLine = (color: string) => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      setShowBorderPicker(false);
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にあることを確認
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        setShowBorderPicker(false);
        return;
      }

      const span = document.createElement("span");
      span.style.borderLeft = `3px solid ${color}`;
      span.style.paddingLeft = "8px";
      span.style.display = "inline-block";

      try {
        range.surroundContents(span);
        handleContentChange();
      } catch {
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
        handleContentChange();
      }
    }
    setShowBorderPicker(false);
  };

  // リンク挿入ダイアログを開く
  const openLinkInput = () => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      return;
    }

    // 現在の選択範囲を保存
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にある場合のみ保存
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
    setShowLinkInput(true);
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setLinkUrl("");
  };

  // リンクカードのDOM要素を生成
  const createLinkNode = (
    url: string,
    title: string,
    favicon: string,
  ): HTMLAnchorElement => {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.dataset.rapitasLinkCard = "1";
    Object.assign(a.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "0 2px",
      background: "#f4f4f5",
      borderRadius: "3px",
      textDecoration: "none",
      color: "#3b82f6",
      fontSize: "13px",
      lineHeight: "1",
      height: "1.5em",
      cursor: "pointer",
      verticalAlign: "text-bottom",
    });

    if (favicon) {
      const img = document.createElement("img");
      img.src = favicon;
      img.alt = "";
      Object.assign(img.style, {
        display: "block",
        width: "13px",
        height: "13px",
        borderRadius: "2px",
        flexShrink: "0",
        objectFit: "cover",
        alignSelf: "center",
      });
      a.appendChild(img);
    }

    const span = document.createElement("span");
    span.textContent = title;
    Object.assign(span.style, {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    a.appendChild(span);

    return a;
  };

  // カーソル位置にノードを挿入するヘルパー
  const insertNodeAtCursor = (node: Node) => {
    const selection = window.getSelection();
    if (savedSelectionRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedSelectionRef.current);
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      const newRange = document.createRange();
      newRange.setStartAfter(node);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } else if (contentRef.current) {
      contentRef.current.appendChild(node);
    }
  };

  // リンクを挿入
  const insertLink = async () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    setIsLinkLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/url-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const meta = await res.json();
      const linkNode = createLinkNode(
        url,
        meta.title || url,
        meta.favicon || "",
      );
      insertNodeAtCursor(linkNode);
      handleContentChange();
    } catch {
      // エラー時はプレーンリンクとして挿入
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = url;
      insertNodeAtCursor(a);
      handleContentChange();
    } finally {
      setIsLinkLoading(false);
      setShowLinkInput(false);
      setLinkUrl("");
      savedSelectionRef.current = null;
    }
  };

  // テーブルのDOM要素を生成
  const createTableNode = (): DocumentFragment => {
    const frag = document.createDocumentFragment();

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["見出し1", "見出し2", "見出し3"].forEach((text) => {
      const th = document.createElement("th");
      th.textContent = text;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let r = 0; r < 2; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < 3; c++) {
        const td = document.createElement("td");
        td.appendChild(document.createElement("br"));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    frag.appendChild(table);

    // テーブル後の空行
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    frag.appendChild(p);

    return frag;
  };

  // テーブル挿入
  const insertTable = () => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      return;
    }

    // コンテンツエディタにフォーカスがない場合は、フォーカスを移す
    if (!contentRef.current?.contains(activeElement)) {
      contentRef.current?.focus();
    }

    const frag = createTableNode();
    const lastChild = frag.lastChild;

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にあることを確認
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        return;
      }
      range.deleteContents();
      range.insertNode(frag);
      if (lastChild) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastChild);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }
    handleContentChange();
  };

  return (
    <div className="flex flex-col h-full">
      {/* タイトル + 保存 */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <input
          type="text"
          value={draftTitle}
          onChange={handleTitleChange}
          onPaste={handleTitlePaste}
          className="flex-1 text-xl font-bold bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100"
          placeholder="タイトルを入力..."
          style={{
            fontStyle: "normal",
            textDecoration: "none",
            fontWeight: 700,
          }}
        />
        <button
          onClick={() => updateNote(note.id, { isPinned: !note.isPinned })}
          className={`p-1.5 rounded-lg transition-colors shrink-0 ${
            note.isPinned
              ? "text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
              : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
          title={note.isPinned ? "ピンを外す" : "ピン留め"}
        >
          <Pin className="w-4 h-4" />
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
            isDirty
              ? "bg-indigo-500 hover:bg-indigo-600 text-white"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-default"
          }`}
          title="保存（Ctrl+S）"
        >
          <Save className="w-3.5 h-3.5" />
          {isDirty ? "保存" : "保存済み"}
        </button>
      </div>

      {/* ツールバー */}
      <div className="flex items-center gap-1 px-4 pb-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => applyFormat("bold")}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          title="太字"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          onClick={() => applyFormat("italic")}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          title="斜体"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          onClick={() => applyFormat("underline")}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          title="下線"
        >
          <Underline className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        <button
          onClick={() => applyFormat("insertUnorderedList")}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          title="箇条書き"
        >
          <List className="w-4 h-4" />
        </button>
        <button
          onClick={() => applyFormat("insertOrderedList")}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          title="番号付きリスト"
        >
          <ListOrdered className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        <div className="relative">
          <button
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowBorderPicker(false);
            }}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
            title="ハイライト"
          >
            <Highlighter className="w-4 h-4" />
          </button>
          {showColorPicker && (
            <div
              className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-52"
              onMouseDown={(e) => e.preventDefault()}
            >
              {/* スタイル選択 */}
              <div className="flex items-center gap-1 mb-2 p-0.5 bg-zinc-100 dark:bg-zinc-700 rounded-md">
                {highlightStyles.map((style, i) => (
                  <button
                    key={style.name}
                    onClick={() => setHighlightStyleIndex(i)}
                    className={`flex-1 py-1 rounded text-xs font-medium transition-all ${
                      highlightStyleIndex === i
                        ? "bg-white dark:bg-zinc-600 shadow-sm text-zinc-900 dark:text-zinc-50"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    }`}
                    title={style.name}
                  >
                    <span
                      style={{
                        background:
                          style.top === 0
                            ? "#fef08a"
                            : `linear-gradient(transparent ${style.top}%, #fef08a ${style.top}%)`,
                      }}
                    >
                      {style.label}
                    </span>
                  </button>
                ))}
              </div>
              {/* カラー選択 */}
              <div className="space-y-1">
                {highlightColors.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => applyHighlight(color.value)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors group"
                  >
                    <span
                      className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200"
                      style={{
                        background:
                          highlightStyles[highlightStyleIndex].top === 0
                            ? color.value
                            : `linear-gradient(transparent ${highlightStyles[highlightStyleIndex].top}%, ${color.value} ${highlightStyles[highlightStyleIndex].top}%)`,
                        padding: "1px 4px",
                        borderRadius: "2px",
                      }}
                    >
                      {color.name}サンプル
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        <div className="relative">
          <button
            onClick={() => {
              setShowBorderPicker(!showBorderPicker);
              setShowColorPicker(false);
            }}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
            title="縦線"
          >
            <TextQuote className="w-4 h-4" />
          </button>
          {showBorderPicker && (
            <div
              className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-40"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="space-y-0.5">
                {borderLineColors.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => applyBorderLine(color.value)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <span
                      className="w-1 h-4 rounded-full shrink-0"
                      style={{ backgroundColor: color.value }}
                    />
                    <span className="text-xs text-zinc-700 dark:text-zinc-200">
                      {color.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={insertTable}
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          title="テーブル挿入"
        >
          <Table className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
        <div className="relative">
          <button
            onClick={openLinkInput}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
            title="リンク挿入"
          >
            <Link2 className="w-4 h-4" />
          </button>
          {showLinkInput && (
            <div
              className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 w-64"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).tagName !== "INPUT") {
                  e.preventDefault();
                }
              }}
            >
              <div className="flex gap-1">
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      insertLink();
                    }
                    if (e.key === "Escape") {
                      setShowLinkInput(false);
                    }
                  }}
                  placeholder="URLを入力..."
                  autoFocus
                  className="flex-1 min-w-0 px-2 py-1 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={insertLink}
                  disabled={!linkUrl.trim() || isLinkLoading}
                  className="px-2 py-1 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-600 text-white rounded text-xs transition-colors disabled:cursor-not-allowed shrink-0"
                >
                  {isLinkLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "挿入"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* エディター本体 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div
          ref={contentRef}
          contentEditable
          suppressContentEditableWarning
          className="p-4 min-h-full outline-none prose prose-zinc dark:prose-invert max-w-none note-editor"
          onInput={handleContentChange}
          onKeyDown={handleEditorKeyDown}
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
          <span>
            作成: {new Date(note.createdAt).toLocaleDateString("ja-JP")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>
            更新: {new Date(note.updatedAt).toLocaleDateString("ja-JP")}
          </span>
        </div>
      </div>
    </div>
  );
}
