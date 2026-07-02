'use client';
// DiagramBlockEdit
import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { X, Save, GitBranch } from 'lucide-react';

interface Props {
  source: string;
  /** Called with the updated source on save / 保存時に新ソースを渡す */
  onSave: (source: string) => void;
  onCancel: () => void;
}

// NOTE: `labelKey` looks up the display label in the `diagramEdit.templates`
// i18n namespace; the Mermaid `source` seed content is left untranslated
// (template body content, not UI chrome).
const TEMPLATES = [
  {
    labelKey: 'flowchart',
    source: `graph TD\n    A[開始] --> B{条件分岐}\n    B -- はい --> C[処理]\n    B -- いいえ --> D[スキップ]\n    C --> E[終了]\n    D --> E`,
  },
  {
    labelKey: 'sequence',
    source: `sequenceDiagram\n    participant ユーザー\n    participant システム\n    ユーザー->>システム: リクエスト\n    システム-->>ユーザー: レスポンス`,
  },
  {
    labelKey: 'state',
    source: `stateDiagram-v2\n    [*] --> 待機\n    待機 --> 処理中 : 開始\n    処理中 --> 完了 : 成功\n    処理中 --> エラー : 失敗\n    完了 --> [*]\n    エラー --> 待機 : リセット`,
  },
  {
    labelKey: 'er',
    source: `erDiagram\n    USER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n    PRODUCT ||--o{ LINE_ITEM : "ordered in"`,
  },
  {
    labelKey: 'class',
    source: `classDiagram\n    class Animal{\n        +String name\n        +speak() String\n    }\n    class Dog {\n        +fetch()\n    }\n    Animal <|-- Dog`,
  },
  {
    labelKey: 'gantt',
    source: `gantt\n    title プロジェクト計画\n    dateFormat YYYY-MM-DD\n    section 設計\n    要件定義 :a1, 2024-01-01, 7d\n    基本設計  :after a1  , 5d\n    section 開発\n    実装      :2024-01-14, 14d`,
  },
] as const;

async function renderPreview(source: string, id: string): Promise<string | null> {
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch {
    return null;
  }
}

let _previewId = 0;

/**
 * Full-screen overlay for editing a Mermaid diagram block.
 * Left pane: source textarea. Right pane: live preview.
 *
 * @param props.source - Initial Mermaid source
 * @param props.onSave - Callback with updated source on save
 * @param props.onCancel - Dismiss without saving
 */
export default function DiagramBlockEdit({ source, onSave, onCancel }: Props) {
  const t = useTranslations('notes');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState(source);
  const [previewSvg, setPreviewSvg] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef(0);

  const triggerPreview = (src: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++counterRef.current;
      const svg = await renderPreview(src, `mermaid-edit-${++_previewId}`);
      if (seq !== counterRef.current) return; // stale
      if (svg) {
        setPreviewSvg(svg);
        setPreviewError(false);
      } else {
        setPreviewError(true);
      }
    }, 400);
  };

  // Render initial preview
  useEffect(() => {
    triggerPreview(source);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (val: string) => {
    setDraft(val);
    triggerPreview(val);
  };

  return (
    <div className="absolute inset-0 z-50 bg-white dark:bg-zinc-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {t('diagramEdit.headerTitle')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSave(draft)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {tc('save')}
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg transition-colors"
            title={tc('cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Templates */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 overflow-x-auto shrink-0">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
          {t('diagramEdit.templatesLabel')}
        </span>
        {TEMPLATES.map((template) => (
          <button
            key={template.labelKey}
            onClick={() => handleChange(template.source)}
            className="shrink-0 px-2 py-0.5 text-[11px] rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          >
            {t(`diagramEdit.templates.${template.labelKey}`)}
          </button>
        ))}
      </div>

      {/* Split panes */}
      <div className="flex-1 flex overflow-hidden">
        {/* Source */}
        <div className="w-1/2 flex flex-col border-r border-zinc-200 dark:border-zinc-700">
          <div className="px-3 py-1 text-[11px] text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            {t('diagramEdit.sourceLabel')}
          </div>
          <textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            autoFocus
            className="flex-1 p-4 font-mono text-sm bg-transparent outline-none resize-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
            placeholder={t('diagramEdit.sourcePlaceholder')}
          />
        </div>

        {/* Preview */}
        <div className="w-1/2 flex flex-col">
          <div className="px-3 py-1 text-[11px] text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            {t('diagramEdit.previewLabel')}
          </div>
          <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
            {previewError ? (
              <div className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 w-full">
                {t('diagramEdit.syntaxError')}
              </div>
            ) : previewSvg ? (
              <div
                dangerouslySetInnerHTML={{ __html: previewSvg }}
                className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto"
              />
            ) : (
              <div className="text-sm text-zinc-400 dark:text-zinc-500">
                {t('diagramEdit.rendering')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
