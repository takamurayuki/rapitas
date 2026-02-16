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
  Code2,
  Baseline,
  ChevronDown,
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

const programmingLanguages = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "ruby", label: "Ruby" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "powershell", label: "PowerShell" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "plaintext", label: "Plain Text" },
];

const fontSizes = [
  { value: "12px", label: "12px" },
  { value: "14px", label: "14px" },
  { value: "16px", label: "16px（標準）" },
  { value: "18px", label: "18px" },
  { value: "20px", label: "20px" },
  { value: "24px", label: "24px" },
  { value: "28px", label: "28px" },
  { value: "32px", label: "32px" },
  { value: "36px", label: "36px" },
];

const fonts = [
  { value: "inherit", label: "デフォルト" },
  { value: "'Noto Sans JP', sans-serif", label: "Noto Sans JP" },
  { value: "'Hiragino Sans', sans-serif", label: "ヒラギノ角ゴ" },
  { value: "'Yu Gothic', sans-serif", label: "游ゴシック" },
  { value: "'Meiryo', sans-serif", label: "メイリオ" },
  { value: "'MS Gothic', monospace", label: "MS ゴシック" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "'Consolas', monospace", label: "Consolas" },
];

const textColors = [
  { name: "黒", value: "#000000" },
  { name: "濃いグレー", value: "#374151" },
  { name: "グレー", value: "#6b7280" },
  { name: "薄いグレー", value: "#9ca3af" },
  { name: "赤", value: "#dc2626" },
  { name: "オレンジ", value: "#ea580c" },
  { name: "黄", value: "#ca8a04" },
  { name: "緑", value: "#16a34a" },
  { name: "青", value: "#2563eb" },
  { name: "藍色", value: "#4f46e5" },
  { name: "紫", value: "#9333ea" },
  { name: "ピンク", value: "#db2777" },
];

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
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState("javascript");
  const savedSelectionRef = useRef<Range | null>(null);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [currentFontSize, setCurrentFontSize] = useState("16");
  const [currentFont, setCurrentFont] = useState("inherit");
  const [currentTextColor, setCurrentTextColor] = useState("#000000");

  // ポップアップの外側をクリックした時に閉じる処理
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // ポップアップが開いている場合のみ処理
      if (
        !showColorPicker &&
        !showBorderPicker &&
        !showLinkInput &&
        !showCodeInput &&
        !showFontSizePicker &&
        !showFontPicker &&
        !showTextColorPicker
      ) {
        return;
      }

      // クリックされた要素がポップアップまたはボタンの子要素でない場合は閉じる
      const isInsidePopup = target.closest(".absolute.top-full") !== null;
      const isButton =
        target.closest(
          'button[title="ハイライト"], button[title="縦線"], button[title="リンク挿入"], button[title="コードブロック挿入"], button[title="文字サイズ"], button[title="フォント"], button[title="文字色"]',
        ) !== null;

      if (!isInsidePopup && !isButton) {
        setShowColorPicker(false);
        setShowBorderPicker(false);
        setShowLinkInput(false);
        setShowCodeInput(false);
        setShowFontSizePicker(false);
        setShowFontPicker(false);
        setShowTextColorPicker(false);
      }
    };

    // ESCキーでポップアップを閉じる処理
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowColorPicker(false);
        setShowBorderPicker(false);
        setShowLinkInput(false);
        setShowCodeInput(false);
        setShowFontSizePicker(false);
        setShowFontPicker(false);
        setShowTextColorPicker(false);
      }
    };

    // イベントリスナーを追加
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscKey);

    // クリーンアップ
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscKey);
    };
  }, [
    showColorPicker,
    showBorderPicker,
    showLinkInput,
    showCodeInput,
    showFontSizePicker,
    showFontPicker,
    showTextColorPicker,
  ]);

  // コンテンツ変更（ダーティフラグのみ）
  const handleContentChange = () => {
    setIsDirty(true);
  };

  // 現在の選択範囲のフォーマットを検出
  const detectCurrentFormat = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.parentNode && node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
    }

    // フォントサイズの検出
    const computedStyle = window.getComputedStyle(node as Element);
    const fontSize = parseInt(computedStyle.fontSize);
    setCurrentFontSize(fontSize.toString());

    // フォントファミリーの検出
    const fontFamily = computedStyle.fontFamily;
    const matchingFont = fonts.find((f) => {
      if (f.value === "inherit") return false;
      return fontFamily.includes(f.value.split(",")[0].replace(/['"]/g, ""));
    });
    setCurrentFont(matchingFont ? matchingFont.value : "inherit");

    // 文字色の検出
    const color = computedStyle.color;
    const rgb = color.match(/\d+/g);
    if (rgb) {
      const hex =
        "#" +
        rgb
          .map((x) => {
            const hex = parseInt(x).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
          })
          .join("")
          .toUpperCase();
      setCurrentTextColor(hex);
    }
  }, []);

  const normalizeLinkCards = useCallback(
    (root: HTMLElement) => {
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

      // コードブロックのイベントハンドラを再設定
      const codeBlocks = Array.from(
        root.querySelectorAll("[data-rapitas-code-block='1']"),
      );
      for (const block of codeBlocks) {
        const codeElement = block.querySelector("code[contenteditable]");
        const buttons = block.querySelectorAll("button");
        const copyButton = buttons[0];
        const deleteButton = buttons[1];

        if (codeElement) {
          codeElement.addEventListener("input", handleContentChange);

          // Backspaceキーでの削除を防ぐ
          codeElement.addEventListener("keydown", (e) => {
            const keyboardEvent = e as KeyboardEvent;
            if (
              keyboardEvent.key === "Backspace" ||
              keyboardEvent.key === "Delete"
            ) {
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                // カーソルがコードブロックの最初にある場合、削除を防ぐ
                if (range.startOffset === 0 && range.collapsed) {
                  const container = range.startContainer;
                  if (
                    container === codeElement ||
                    (container.parentNode === codeElement &&
                      container.previousSibling === null)
                  ) {
                    e.preventDefault();
                    return;
                  }
                }
              }
            }
          });
        }

        // コピーボタンのイベントハンドラ再設定
        if (copyButton && codeElement) {
          copyButton.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const codeText = codeElement.textContent || "";
            navigator.clipboard.writeText(codeText).then(() => {
              const originalText = copyButton.textContent;
              copyButton.textContent = "コピーしました！";
              (copyButton as HTMLElement).style.backgroundColor = "#22c55e";
              setTimeout(() => {
                copyButton.textContent = originalText;
                (copyButton as HTMLElement).style.backgroundColor = "#334155";
              }, 2000);
            });
          };
        }

        // 削除ボタンのイベントハンドラ再設定
        if (deleteButton) {
          deleteButton.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // コードブロックコンテナ全体を削除
            (block as HTMLElement).remove();
            handleContentChange();
          };
        }
      }
    },
    [handleContentChange],
  );

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

  // 選択変更時にフォーマット検出
  useEffect(() => {
    const handleSelectionChange = () => {
      if (contentRef.current?.contains(document.activeElement)) {
        detectCurrentFormat();
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [detectCurrentFormat]);

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
    setShowCodeInput(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
    setLinkUrl("");
  };

  // コードブロック挿入ダイアログを開く
  const openCodeInput = () => {
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
    setShowCodeInput(true);
    setShowColorPicker(false);
    setShowBorderPicker(false);
    setShowLinkInput(false);
    setShowFontSizePicker(false);
    setShowFontPicker(false);
    setShowTextColorPicker(false);
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

  // 文字サイズ適用
  const applyFontSize = (size: string) => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      setShowFontSizePicker(false);
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にあることを確認
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        setShowFontSizePicker(false);
        return;
      }

      const span = document.createElement("span");
      span.style.fontSize = size;

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
    setShowFontSizePicker(false);
  };

  // フォント適用
  const applyFont = (font: string) => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      setShowFontPicker(false);
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にあることを確認
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        setShowFontPicker(false);
        return;
      }

      const span = document.createElement("span");
      span.style.fontFamily = font;

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
    setShowFontPicker(false);
  };

  // 文字色適用
  const applyTextColor = (color: string) => {
    // タイトル入力欄にフォーカスがある場合は何もしない
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === "INPUT" &&
      (activeElement as HTMLInputElement).type === "text"
    ) {
      setShowTextColorPicker(false);
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // 選択範囲がコンテンツエディタ内にあることを確認
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        setShowTextColorPicker(false);
        return;
      }

      const span = document.createElement("span");
      span.style.color = color;

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
    setShowTextColorPicker(false);
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

  // コードブロックのDOM要素を生成
  const createCodeBlockNode = (
    language: string,
    code: string = "",
  ): DocumentFragment => {
    const frag = document.createDocumentFragment();

    // 簡単なシンタックスハイライト関数
    const highlightCode = (text: string, lang: string): string => {
      // エスケープ処理
      let highlighted = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // 言語別のキーワード
      const keywords: { [key: string]: string[] } = {
        javascript: [
          "const",
          "let",
          "var",
          "function",
          "return",
          "if",
          "else",
          "for",
          "while",
          "class",
          "extends",
          "new",
          "this",
          "super",
          "import",
          "export",
          "default",
          "from",
          "async",
          "await",
          "try",
          "catch",
          "throw",
          "finally",
        ],
        typescript: [
          "const",
          "let",
          "var",
          "function",
          "return",
          "if",
          "else",
          "for",
          "while",
          "class",
          "extends",
          "new",
          "this",
          "super",
          "import",
          "export",
          "default",
          "from",
          "async",
          "await",
          "try",
          "catch",
          "throw",
          "finally",
          "interface",
          "type",
          "enum",
          "implements",
          "private",
          "public",
          "protected",
        ],
        python: [
          "def",
          "class",
          "if",
          "else",
          "elif",
          "for",
          "while",
          "return",
          "import",
          "from",
          "as",
          "try",
          "except",
          "finally",
          "with",
          "lambda",
          "yield",
          "pass",
          "break",
          "continue",
          "True",
          "False",
          "None",
          "and",
          "or",
          "not",
          "in",
          "is",
        ],
        java: [
          "public",
          "private",
          "protected",
          "class",
          "interface",
          "extends",
          "implements",
          "static",
          "final",
          "void",
          "int",
          "String",
          "boolean",
          "if",
          "else",
          "for",
          "while",
          "return",
          "new",
          "this",
          "super",
          "try",
          "catch",
          "finally",
          "throw",
          "throws",
        ],
        // 他の言語も同様に追加可能
      };

      const langKeywords = keywords[lang] || [];

      if (langKeywords.length > 0) {
        // キーワードのハイライト
        const keywordRegex = new RegExp(
          `\\b(${langKeywords.join("|")})\\b`,
          "g",
        );
        highlighted = highlighted.replace(
          keywordRegex,
          '<span style="color: #c792ea;">$1</span>',
        );
      }

      // 文字列のハイライト（シングル・ダブル・バッククォート）
      highlighted = highlighted.replace(
        /(["'`])(?:(?=(\\?))\2.)*?\1/g,
        '<span style="color: #c3e88d;">$&</span>',
      );

      // コメントのハイライト
      if (
        [
          "javascript",
          "typescript",
          "java",
          "c",
          "cpp",
          "csharp",
          "go",
          "rust",
          "swift",
          "kotlin",
          "php",
        ].includes(lang)
      ) {
        // 単一行コメント
        highlighted = highlighted.replace(
          /(\/\/.*$)/gm,
          '<span style="color: #546e7a; font-style: italic;">$1</span>',
        );
        // 複数行コメント
        highlighted = highlighted.replace(
          /(\/\*[\s\S]*?\*\/)/g,
          '<span style="color: #546e7a; font-style: italic;">$1</span>',
        );
      } else if (
        ["python", "ruby", "bash", "powershell", "yaml"].includes(lang)
      ) {
        // #コメント
        highlighted = highlighted.replace(
          /(#.*$)/gm,
          '<span style="color: #546e7a; font-style: italic;">$1</span>',
        );
      } else if (["html", "xml"].includes(lang)) {
        // HTMLコメント
        highlighted = highlighted.replace(
          /(<!--[\s\S]*?-->)/g,
          '<span style="color: #546e7a; font-style: italic;">$1</span>',
        );
      } else if (lang === "css") {
        // CSSコメント
        highlighted = highlighted.replace(
          /(\/\*[\s\S]*?\*\/)/g,
          '<span style="color: #546e7a; font-style: italic;">$1</span>',
        );
      }

      // 数値のハイライト
      highlighted = highlighted.replace(
        /\b(\d+(?:\.\d+)?)\b/g,
        '<span style="color: #f78c6c;">$1</span>',
      );

      return highlighted;
    };

    const container = document.createElement("div");
    container.className = "code-block-container";
    container.dataset.rapitasCodeBlock = "1";
    container.style.position = "relative";
    container.style.marginBottom = "16px";
    container.style.borderRadius = "8px";
    container.style.overflow = "hidden";
    container.style.backgroundColor = "#1e293b";
    container.style.border = "1px solid #334155";

    // ヘッダー部分（言語名とコピーボタン）
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.padding = "8px 12px";
    header.style.backgroundColor = "#0f172a";
    header.style.borderBottom = "1px solid #334155";

    // 言語ラベル
    const langLabel = document.createElement("span");
    langLabel.textContent =
      programmingLanguages.find((l) => l.value === language)?.label || language;
    langLabel.style.fontSize = "12px";
    langLabel.style.color = "#94a3b8";
    langLabel.style.fontFamily = "monospace";
    header.appendChild(langLabel);

    // ボタンコンテナ
    const buttonContainer = document.createElement("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "8px";

    // コピーボタン
    const copyButton = document.createElement("button");
    copyButton.textContent = "コピー";
    copyButton.style.padding = "4px 12px";
    copyButton.style.fontSize = "12px";
    copyButton.style.backgroundColor = "#334155";
    copyButton.style.color = "#e2e8f0";
    copyButton.style.border = "none";
    copyButton.style.borderRadius = "4px";
    copyButton.style.cursor = "pointer";
    copyButton.style.transition = "all 0.2s";
    copyButton.onmouseover = () => {
      copyButton.style.backgroundColor = "#475569";
    };
    copyButton.onmouseout = () => {
      copyButton.style.backgroundColor = "#334155";
    };

    // 削除ボタン
    const deleteButton = document.createElement("button");
    deleteButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"/></svg>`;
    deleteButton.style.padding = "4px 8px";
    deleteButton.style.fontSize = "12px";
    deleteButton.style.backgroundColor = "#ef4444";
    deleteButton.style.color = "#ffffff";
    deleteButton.style.border = "none";
    deleteButton.style.borderRadius = "4px";
    deleteButton.style.cursor = "pointer";
    deleteButton.style.transition = "all 0.2s";
    deleteButton.style.display = "flex";
    deleteButton.style.alignItems = "center";
    deleteButton.title = "削除";
    deleteButton.dataset.deleteHandler = "1";
    deleteButton.onmouseover = () => {
      deleteButton.style.backgroundColor = "#dc2626";
    };
    deleteButton.onmouseout = () => {
      deleteButton.style.backgroundColor = "#ef4444";
    };

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(deleteButton);
    header.appendChild(buttonContainer);
    container.appendChild(header);

    // コード部分
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.padding = "16px";
    pre.style.overflowX = "auto";
    pre.style.backgroundColor = "#1e293b";

    const codeElement = document.createElement("code");
    codeElement.className = `language-${language}`;
    codeElement.textContent = code || "// ここにコードを入力...";
    codeElement.style.fontFamily =
      "'Consolas', 'Monaco', 'Courier New', monospace";
    codeElement.style.fontSize = "14px";
    codeElement.style.lineHeight = "1.5";
    codeElement.style.color = "#e2e8f0";
    codeElement.contentEditable = "true";
    codeElement.style.outline = "none";
    codeElement.style.display = "block";
    codeElement.style.whiteSpace = "pre";
    codeElement.spellcheck = false;

    // コードブロック内でのキーバインドと補完
    codeElement.onkeydown = (e) => {
      const keyboardEvent = e as KeyboardEvent;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      // Backspace/Deleteキーでの削除を制御
      if (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") {
        const range = selection.getRangeAt(0);
        // カーソルがコードブロックの最初にある場合、削除を防ぐ
        if (range.startOffset === 0 && range.collapsed) {
          const container = range.startContainer;
          if (
            container === codeElement ||
            (container.parentNode === codeElement &&
              container.previousSibling === null)
          ) {
            e.preventDefault();
            return;
          }
        }
      }

      // Enter キー
      if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
        e.preventDefault();

        const range = selection.getRangeAt(0);
        const currentLine = getCurrentLine(range);
        const indent = getIndentation(currentLine);
        const shouldIncreaseIndent = shouldAutoIndent(currentLine, language);

        // 新しい行を挿入
        let newLineText = "\n" + indent;
        if (shouldIncreaseIndent) {
          newLineText += getIndentString(language);
        }

        document.execCommand("insertText", false, newLineText);
      }

      // Tab キー（インデント）
      if (keyboardEvent.key === "Tab") {
        e.preventDefault();
        const indentString = getIndentString(language);
        document.execCommand("insertText", false, indentString);
      }

      // 括弧の自動補完
      const autoPairs: { [key: string]: string } = {
        "(": ")",
        "[": "]",
        "{": "}",
        '"': '"',
        "'": "'",
        "`": "`",
      };

      if (autoPairs[keyboardEvent.key]) {
        e.preventDefault();
        const closing = autoPairs[keyboardEvent.key];
        const range = selection.getRangeAt(0);

        // テキストが選択されている場合は囲む
        if (!range.collapsed) {
          const selectedText = range.toString();
          document.execCommand(
            "insertText",
            false,
            keyboardEvent.key + selectedText + closing,
          );

          // カーソルを閉じ括弧の前に移動
          const newRange = document.createRange();
          const textNode = range.startContainer;
          if (textNode.nodeType === Node.TEXT_NODE) {
            newRange.setStart(
              textNode,
              range.startOffset + 1 + selectedText.length,
            );
            newRange.setEnd(
              textNode,
              range.startOffset + 1 + selectedText.length,
            );
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } else {
          // 通常の自動補完
          document.execCommand(
            "insertText",
            false,
            keyboardEvent.key + closing,
          );

          // カーソルを戻す
          const newRange = document.createRange();
          const textNode = range.startContainer;
          if (textNode.nodeType === Node.TEXT_NODE) {
            const offset = range.startOffset + 1;
            newRange.setStart(textNode, offset);
            newRange.setEnd(textNode, offset);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        }
      }
    };

    // ヘルパー関数
    const getCurrentLine = (range: Range): string => {
      const container = range.startContainer;
      const text = container.textContent || "";
      const beforeCursor = text.substring(0, range.startOffset);
      const lines = beforeCursor.split("\n");
      return lines[lines.length - 1];
    };

    const getIndentation = (line: string): string => {
      const match = line.match(/^(\s*)/);
      return match ? match[1] : "";
    };

    const getIndentString = (lang: string): string => {
      // Python は通常スペース4つ、その他は2つ
      if (lang === "python") return "    ";
      if (lang === "go" || lang === "rust") return "\t";
      return "  ";
    };

    const shouldAutoIndent = (line: string, lang: string): boolean => {
      const trimmed = line.trim();

      // 言語別のインデントルール
      if (
        [
          "javascript",
          "typescript",
          "java",
          "csharp",
          "cpp",
          "c",
          "rust",
          "go",
          "php",
          "swift",
          "kotlin",
        ].includes(lang)
      ) {
        if (trimmed.endsWith("{")) return true;
      }

      if (["python", "ruby"].includes(lang)) {
        if (trimmed.endsWith(":")) return true;
      }

      if (["html", "xml"].includes(lang)) {
        // 開始タグで終わる場合
        if (
          /<[^>]+>$/.test(trimmed) &&
          !/<\/[^>]+>$/.test(trimmed) &&
          !/>\/\s*$/.test(trimmed)
        ) {
          return true;
        }
      }

      return false;
    };

    // コピーボタンのクリックイベント
    copyButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const codeText = codeElement.textContent || "";
      navigator.clipboard.writeText(codeText).then(() => {
        const originalText = copyButton.textContent;
        copyButton.textContent = "コピーしました！";
        copyButton.style.backgroundColor = "#22c55e";
        setTimeout(() => {
          copyButton.textContent = originalText;
          copyButton.style.backgroundColor = "#334155";
        }, 2000);
      });
    };

    // 削除ボタンのクリックイベントは後で設定（handleContentChangeへのアクセスのため）

    pre.appendChild(codeElement);
    container.appendChild(pre);

    // コンテナに削除ハンドラフラグを設定
    container.dataset.needsDeleteHandler = "1";

    frag.appendChild(container);

    // コードブロック後の空行
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    frag.appendChild(p);

    return frag;
  };

  // コードブロック挿入
  const insertCodeBlock = () => {
    const frag = createCodeBlockNode(codeLanguage);
    const lastChild = frag.lastChild;

    if (savedSelectionRef.current) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(savedSelectionRef.current);
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(frag);
        if (lastChild) {
          const newRange = document.createRange();
          newRange.setStartAfter(lastChild);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }

    // 削除ハンドラを設定
    if (contentRef.current) {
      const newBlocks = contentRef.current.querySelectorAll(
        '[data-needs-delete-handler="1"]',
      );
      newBlocks.forEach((block) => {
        const deleteButton = block.querySelector('[data-delete-handler="1"]');
        if (deleteButton) {
          (deleteButton as HTMLElement).onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            (block as HTMLElement).remove();
            handleContentChange();
          };
        }
        (block as HTMLElement).removeAttribute("data-needs-delete-handler");
      });
    }

    handleContentChange();
    setShowCodeInput(false);
    savedSelectionRef.current = null;
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
      <div className="flex items-center gap-0.5 px-4 pb-1.5 border-b border-zinc-200 dark:border-zinc-700">
        {/* フォントファミリー */}
        <div className="relative">
          <button
            onClick={() => {
              setShowFontPicker(!showFontPicker);
              setShowFontSizePicker(false);
              setShowTextColorPicker(false);
              setShowColorPicker(false);
              setShowBorderPicker(false);
              setShowLinkInput(false);
              setShowCodeInput(false);
            }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-xs min-w-[100px] justify-between h-6"
            title="フォント"
          >
            <span className="truncate">
              {fonts.find((f) => f.value === currentFont)?.label ||
                "デフォルト"}
            </span>
            <ChevronDown className="w-2.5 h-2.5 shrink-0" />
          </button>
          {showFontPicker && (
            <div
              className="absolute top-full left-0 mt-1 p-1 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-52 max-h-64 overflow-y-auto"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="space-y-0.5">
                {fonts.map((font) => (
                  <button
                    key={font.value}
                    onClick={() => {
                      setCurrentFont(font.value);
                      applyFont(font.value);
                      setShowFontPicker(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-sm ${
                      currentFont === font.value
                        ? "bg-zinc-100 dark:bg-zinc-700"
                        : ""
                    }`}
                  >
                    <span style={{ fontFamily: font.value }}>{font.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* フォントサイズ */}
        <div className="relative">
          <input
            type="text"
            value={currentFontSize}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9]/g, "");
              if (
                value === "" ||
                (parseInt(value) >= 8 && parseInt(value) <= 72)
              ) {
                setCurrentFontSize(value);
              }
            }}
            onBlur={() => {
              if (currentFontSize === "") {
                setCurrentFontSize("16");
                applyFontSize("16px");
              } else {
                applyFontSize(`${currentFontSize}px`);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const size =
                  currentFontSize === "" ? 16 : parseInt(currentFontSize);
                applyFontSize(`${size}px`);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-10 px-0.5 text-center text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500 h-6 rounded"
            title="フォントサイズ"
          />
          <button
            onClick={() => {
              setShowFontSizePicker(!showFontSizePicker);
              setShowFontPicker(false);
              setShowTextColorPicker(false);
              setShowColorPicker(false);
              setShowBorderPicker(false);
              setShowLinkInput(false);
              setShowCodeInput(false);
            }}
            className="absolute right-0 top-0 bottom-0 px-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors rounded-r"
          >
            <ChevronDown className="w-2.5 h-2.5" />
          </button>
          {showFontSizePicker && (
            <div
              className="absolute top-full left-0 mt-1 p-1 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-16"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {[
                  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 48,
                  72,
                ].map((size) => (
                  <button
                    key={size}
                    onClick={() => {
                      setCurrentFontSize(size.toString());
                      applyFontSize(`${size}px`);
                      setShowFontSizePicker(false);
                    }}
                    className={`w-full text-left px-2 py-0.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-xs ${
                      currentFontSize === size.toString()
                        ? "bg-zinc-100 dark:bg-zinc-700"
                        : ""
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* 基本装飾 */}
        <button
          onClick={() => applyFormat("bold")}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="太字"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => applyFormat("italic")}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="斜体"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => applyFormat("underline")}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="下線"
        >
          <Underline className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* 文字色 */}
        <div className="relative">
          <button
            onClick={() => {
              setShowTextColorPicker(!showTextColorPicker);
              setShowFontSizePicker(false);
              setShowFontPicker(false);
              setShowColorPicker(false);
              setShowBorderPicker(false);
              setShowLinkInput(false);
              setShowCodeInput(false);
            }}
            className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
            title="文字色"
          >
            <Baseline
              className="w-3.5 h-3.5"
              style={{ color: currentTextColor }}
            />
          </button>
          {showTextColorPicker && (
            <div
              className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 min-w-60"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
                テキスト色
              </div>

              {/* よく使う色 */}
              <div className="flex justify-between gap-1 mb-3">
                {[
                  { color: "#000000", name: "黒" },
                  { color: "#DC2626", name: "赤" },
                  { color: "#EA580C", name: "橙" },
                  { color: "#16A34A", name: "緑" },
                  { color: "#2563EB", name: "青" },
                  { color: "#9333EA", name: "紫" },
                ].map((item) => (
                  <button
                    key={item.color}
                    onClick={() => {
                      setCurrentTextColor(item.color);
                      applyTextColor(item.color);
                      setShowTextColorPicker(false);
                    }}
                    className={`w-8 h-8 rounded-md border transition-all flex items-center justify-center ${
                      currentTextColor === item.color
                        ? "border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20"
                        : "border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500"
                    }`}
                    title={item.name}
                  >
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                  </button>
                ))}
              </div>

              <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-3" />

              {/* カラーパレット */}
              <div className="space-y-1.5 mb-3">
                <div>
                  <div className="grid grid-cols-10 gap-1">
                    {[
                      "#FFFFFF",
                      "#F4F4F5",
                      "#E4E4E7",
                      "#D4D4D8",
                      "#A1A1AA",
                      "#71717A",
                      "#52525B",
                      "#3F3F46",
                      "#27272A",
                      "#000000",
                    ].map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          setCurrentTextColor(color);
                          applyTextColor(color);
                          setShowTextColorPicker(false);
                        }}
                        className={`w-5 h-5 rounded hover:scale-110 transition-all border ${
                          currentTextColor.toUpperCase() === color
                            ? "border-indigo-500 dark:border-indigo-400 ring-1 ring-indigo-500"
                            : "border-zinc-200 dark:border-zinc-600"
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="grid grid-cols-10 gap-1">
                    {[
                      "#FCA5A5",
                      "#FDBA74",
                      "#FDE047",
                      "#BEF264",
                      "#86EFAC",
                      "#6EE7B7",
                      "#5EEAD4",
                      "#7DD3FC",
                      "#93C5FD",
                      "#C4B5FD",
                      "#E9D5FF",
                      "#F9A8D4",
                      "#FDA4AF",
                      "#FCD34D",
                      "#A3E635",
                      "#4ADE80",
                      "#2DD4BF",
                      "#38BDF8",
                      "#818CF8",
                      "#C084FC",
                    ].map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          setCurrentTextColor(color);
                          applyTextColor(color);
                          setShowTextColorPicker(false);
                        }}
                        className={`w-5 h-5 rounded hover:scale-110 transition-all border ${
                          currentTextColor.toUpperCase() === color
                            ? "border-indigo-500 dark:border-indigo-400 ring-1 ring-indigo-500"
                            : "border-zinc-200 dark:border-zinc-600"
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* リセットボタン */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
                <button
                  className="w-full text-center text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 py-1 px-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  onClick={() => {
                    const defaultColor =
                      document.documentElement.classList.contains("dark")
                        ? "#E4E4E7"
                        : "#000000";
                    setCurrentTextColor(defaultColor);
                    applyTextColor(defaultColor);
                    setShowTextColorPicker(false);
                  }}
                >
                  デフォルト
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ハイライト */}
        <div className="relative">
          <button
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowBorderPicker(false);
              setShowLinkInput(false);
              setShowCodeInput(false);
              setShowFontSizePicker(false);
              setShowFontPicker(false);
              setShowTextColorPicker(false);
            }}
            className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
            title="ハイライト"
          >
            <Highlighter className="w-3.5 h-3.5" />
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

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* リスト */}
        <button
          onClick={() => applyFormat("insertUnorderedList")}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="箇条書き"
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => applyFormat("insertOrderedList")}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="番号付きリスト"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* 挿入系 */}
        <div className="relative">
          <button
            onClick={openLinkInput}
            className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
            title="リンク挿入"
          >
            <Link2 className="w-3.5 h-3.5" />
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

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        <div className="relative">
          <button
            onClick={() => {
              setShowBorderPicker(!showBorderPicker);
              setShowColorPicker(false);
              setShowLinkInput(false);
              setShowCodeInput(false);
              setShowFontSizePicker(false);
              setShowFontPicker(false);
              setShowTextColorPicker(false);
            }}
            className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
            title="縦線"
          >
            <TextQuote className="w-3.5 h-3.5" />
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
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="テーブル挿入"
        >
          <Table className="w-3.5 h-3.5" />
        </button>
        <div className="relative">
          <button
            onClick={openCodeInput}
            className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
            title="コードブロック挿入"
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          {showCodeInput && (
            <div
              className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 w-64"
              onMouseDown={(e) => {
                if (
                  (e.target as HTMLElement).tagName !== "SELECT" &&
                  (e.target as HTMLElement).tagName !== "BUTTON"
                ) {
                  e.preventDefault();
                }
              }}
            >
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                プログラミング言語を選択
              </label>
              <select
                value={codeLanguage}
                onChange={(e) => setCodeLanguage(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2"
              >
                {programmingLanguages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <button
                onClick={insertCodeBlock}
                className="w-full px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-sm transition-colors"
              >
                挿入
              </button>
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
