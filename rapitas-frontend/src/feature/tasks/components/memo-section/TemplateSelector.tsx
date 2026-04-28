'use client';
// TemplateSelector

import { memo } from 'react';
import { X, FileText, ChevronLeft } from 'lucide-react';
import type { MemoType, MemoTemplate } from './types';
import { MEMO_TEMPLATES, MEMO_TYPE_CONFIG } from './types';

/**
 * Renders a full-screen modal listing templates filtered by selectedType.
 *
 * @param selectedType - The currently active memo type used to filter templates / 現在選択中のメモ種別
 * @param onSelect - Called when the user picks a template / テンプレート選択時のコールバック
 * @param onClose - Called when the modal should be dismissed / モーダルを閉じる際のコールバック
 */
export const TemplateSelector = memo(function TemplateSelector({
  selectedType,
  onSelect,
  onClose,
}: {
  selectedType: MemoType;
  onSelect: (template: MemoTemplate) => void;
  onClose: () => void;
}) {
  const filteredTemplates = MEMO_TEMPLATES.filter(
    (t) => t.type === selectedType || selectedType === 'general',
  );
  const typeConfig = MEMO_TYPE_CONFIG[selectedType];
  const TypeIcon = typeConfig.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                メモテンプレート選択
              </span>
              <div
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full ${typeConfig.color.badge}`}
              >
                <TypeIcon className="w-2.5 h-2.5" />
                {typeConfig.label}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Templates */}
        <div className="max-h-80 overflow-y-auto">
          {filteredTemplates.length > 0 ? (
            <div className="p-2 space-y-1">
              {filteredTemplates.map((template) => {
                const templateTypeConfig = MEMO_TYPE_CONFIG[template.type];
                const TemplateIcon = templateTypeConfig.icon;
                return (
                  <button
                    key={template.id}
                    onClick={() => onSelect(template)}
                    className="w-full text-left p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-lg ${templateTypeConfig.color.bg}`}>
                        <TemplateIcon className={`w-3.5 h-3.5 ${templateTypeConfig.color.text}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {template.label}
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                          {template.description}
                        </p>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500 transition-colors rotate-180" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center">
              <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {typeConfig.label}用のテンプレートがありません
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="w-full px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
          >
            手動で入力
          </button>
        </div>
      </div>
    </div>
  );
});
