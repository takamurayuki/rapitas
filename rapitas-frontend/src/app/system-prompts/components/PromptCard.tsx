'use client';

/**
 * PromptCard
 *
 * Collapsible card for a single system prompt, supporting inline view and edit modes.
 * Does not handle persistence — delegates all mutations to parent callbacks.
 */

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Save,
  X,
  RotateCcw,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { CATEGORY_LABELS, type SystemPrompt } from './types';

interface PromptCardProps {
  prompt: SystemPrompt;
  isExpanded: boolean;
  isEditing: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** @param updates - Partial fields to patch on the prompt / パッチするフィールド */
  onSave: (updates: Partial<SystemPrompt>) => void;
  onReset: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}

/**
 * Expandable prompt card with toggle, view, and edit sub-panels.
 *
 * @param props - PromptCardProps
 */
export function PromptCard({
  prompt,
  isExpanded,
  isEditing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onReset,
  onDelete,
  onToggleActive,
}: PromptCardProps) {
  const t = useTranslations('prompts');
  const tc = useTranslations('common');
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (isEditing) {
      // NOTE: setTimeout avoids synchronous setState during render cycle.
      const timeoutId = setTimeout(() => {
        setEditContent(prompt.content);
        setEditName(prompt.name);
        setEditDescription(prompt.description || '');
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isEditing, prompt]);

  const categoryInfo = CATEGORY_LABELS[prompt.category] || {
    labelKey: prompt.category,
    color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
  };

  return (
    <div
      className={`bg-white dark:bg-zinc-800 rounded-lg border transition-all ${
        prompt.isActive
          ? 'border-zinc-200 dark:border-zinc-700'
          : 'border-zinc-200 dark:border-zinc-700 opacity-60'
      }`}
    >
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => !isEditing && onToggleExpand()}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button className="text-zinc-400 dark:text-zinc-500 shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {prompt.name}
              </h3>
              {prompt.isDefault && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded shrink-0">
                  <Shield className="w-3 h-3" />
                  {t('defaultLabel')}
                </span>
              )}
              <span className={`px-1.5 py-0.5 text-xs rounded shrink-0 ${categoryInfo.color}`}>
                {t(categoryInfo.labelKey)}
              </span>
            </div>
            {prompt.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {prompt.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggleActive}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              prompt.isActive ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                prompt.isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 p-4">
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('name')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('description')}
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('promptContent')}
                </label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={15}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {prompt.isDefault && (
                    <button
                      onClick={onReset}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t('resetToDefault')}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onCancelEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                    {tc('cancel')}
                  </button>
                  <button
                    onClick={() =>
                      onSave({
                        name: editName,
                        description: editDescription || null,
                        content: editContent,
                      } as Partial<SystemPrompt>)
                    }
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {tc('save')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-zinc-400 dark:text-zinc-500">
                  {t('keyLabel')}{' '}
                  <code className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-700 rounded">
                    {prompt.key}
                  </code>
                  <span className="mx-2">|</span>
                  {t('updatedLabel')} {new Date(prompt.updatedAt).toLocaleString('ja-JP')}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    {tc('edit')}
                  </button>
                  {!prompt.isDefault && (
                    <button
                      onClick={onDelete}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {tc('delete')}
                    </button>
                  )}
                  {prompt.isDefault && (
                    <button
                      onClick={onReset}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t('reset')}
                    </button>
                  )}
                </div>
              </div>
              <pre className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg text-sm text-zinc-800 dark:text-zinc-200 font-mono whitespace-pre-wrap overflow-auto max-h-96 border border-zinc-200 dark:border-zinc-700">
                {prompt.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
