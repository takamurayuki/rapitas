'use client';
// use-option-catalog

import { useState } from 'react';
import type { AppAnswers, DynamicItem } from '../_types/types';
import { ELEMENTS, SUB_GENRES } from '../_utils/constants';

/** lucide icon name for user-added custom sub-genres/elements. / 自由入力で追加した項目のアイコン */
const CUSTOM_ICON = 'Plus';

/**
 * Builds a stable, collision-resistant id for a user-typed custom option.
 *
 * @param label - the free-text label / 自由入力されたラベル
 * @returns a `custom_`-prefixed id / `custom_`接頭辞付きID
 */
export function customId(label: string): string {
  return `custom_${label.trim().toLowerCase().replace(/\s+/g, '_')}`;
}

/** What {@link useOptionCatalog} needs from the wizard. */
interface OptionCatalogDeps {
  answers: AppAnswers;
  setAnswers: React.Dispatch<React.SetStateAction<AppAnswers>>;
  t: (key: string) => string;
}

/**
 * Owns the sub-genre and element option lists the hearing presents.
 *
 * Extracted from use-wizard, which reached the 500-line hard limit. Keeping the
 * catalog here also gives the option sources one home: the static catalogs, the
 * user's own free-text additions, and (next) model-proposed options all land in
 * the same two lists.
 *
 * @param deps - Wizard answers and the translator / ウィザードの回答と翻訳関数
 * @returns The two option lists and the actions that grow them / 選択肢リストと操作
 */
export function useOptionCatalog({ answers: _answers, setAnswers, t }: OptionCatalogDeps) {
  const [dynamicSubs, setDynamicSubs] = useState<DynamicItem[]>([]);
  const [dynamicElements, setDynamicElements] = useState<DynamicItem[]>([]);

  /**
   * Seeds sub-genre options for a genre from the static catalog.
   *
   * @param genreId - the genre just picked / 選択されたジャンルID
   */
  const seedSubs = (genreId: string) => {
    const staticSubs = SUB_GENRES[genreId] || [];
    setDynamicSubs(
      staticSubs.map((s) => ({ id: s.id, icon: s.icon, label: t(`sub_${genreId}_${s.id}`) })),
    );
  };

  /** Seeds element options once; re-entry preserves the user's additions. */
  const seedElements = () => {
    setDynamicElements((prev) =>
      prev.length > 0
        ? prev
        : ELEMENTS.map((e) => ({ id: e.id, icon: e.icon, label: t('elem_' + e.id) })),
    );
  };

  /**
   * Adds a user-typed custom sub-genre to the option list and selects it.
   *
   * @param label - free-text sub-genre name / 自由入力のサブジャンル名
   */
  const addCustomSub = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = customId(trimmed);
    setDynamicSubs((prev) =>
      prev.some((s) => s.id === id) ? prev : [...prev, { id, icon: CUSTOM_ICON, label: trimmed }],
    );
    setAnswers((a) => ({
      ...a,
      subs: a.subs?.includes(id) ? a.subs : [...(a.subs || []), id],
    }));
  };

  /**
   * Adds a user-typed custom element/feature to the option list and selects it.
   *
   * @param label - free-text element name / 自由入力の機能要素名
   */
  const addCustomElement = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = customId(trimmed);
    setDynamicElements((prev) =>
      prev.some((e) => e.id === id) ? prev : [...prev, { id, icon: CUSTOM_ICON, label: trimmed }],
    );
    setAnswers((a) => ({
      ...a,
      elements: a.elements?.includes(id) ? a.elements : [...(a.elements || []), id],
    }));
  };

  /**
   * Merges model-proposed options into a list without disturbing selections.
   *
   * Ids already present win, so a proposal can never replace a static option or
   * duplicate one the user typed.
   *
   * @param into - 'subs' or 'elements' / 追加先
   * @param items - Proposed options / 提案された選択肢
   */
  const mergeProposed = (into: 'subs' | 'elements', items: readonly DynamicItem[]) => {
    const setter = into === 'subs' ? setDynamicSubs : setDynamicElements;
    setter((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...items.filter((i) => !seen.has(i.id))];
    });
  };

  const reset = () => {
    setDynamicSubs([]);
    setDynamicElements([]);
  };

  return {
    dynamicSubs,
    dynamicElements,
    seedSubs,
    seedElements,
    addCustomSub,
    addCustomElement,
    mergeProposed,
    reset,
  };
}
