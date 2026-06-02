'use client';
// elements-phase

import React, { useState } from 'react';
import type { DynamicItem } from '../_types/types';
import { ELEMENTS } from '../_utils/constants';
import { PageWrap } from './page-wrap';
import { CheckIcon } from './icons';
import { CustomOptionInput } from './custom-option-input';
import { WizardIcon } from './wizard-icons';

interface ElementsPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** Currently selected element ids / 選択済み要素ID一覧 */
  selectedElements: string[];
  /** Element options (static catalog + user-added custom items) / 機能要素の選択肢（静的＋自由入力） */
  dynamicElements: DynamicItem[];
  /** Toggles an element selection by id / IDで要素選択を切り替える */
  onToggle: (id: string) => void;
  /** Adds a user-typed custom element / 自由入力の機能要素を追加 */
  onAddCustom: (label: string) => void;
  /** Advances to platform phase / プラットフォームフェーズへ進む */
  onNext: () => void;
  /** Returns to sub-genre phase / サブジャンルフェーズへ戻る */
  onBack: () => void;
}

/**
 * Elements multi-select grid with a free-input field for custom entries,
 * wrapped in the shared PageWrap layout. Options come from the local static
 * catalog — no per-selection AI call.
 *
 * @param props - ElementsPhaseProps / ElementsPhaseProps参照
 */
export function ElementsPhase({
  topRef,
  t,
  selectedElements,
  dynamicElements,
  onToggle,
  onAddCustom,
  onNext,
  onBack,
}: ElementsPhaseProps) {
  const elements =
    dynamicElements.length > 0
      ? dynamicElements
      : ELEMENTS.map((e) => ({
          id: e.id,
          icon: e.icon,
          label: t(`elem_${e.id}`),
        }));

  const [pulse, setPulse] = useState(false);
  const handleAdd = (label: string) => {
    onAddCustom(label);
    setPulse(true);
    setTimeout(() => setPulse(false), 400);
  };

  return (
    <PageWrap
      topRef={topRef}
      title={t('elementsTitle')}
      sub={t('elementsSub')}
      step={3}
      total={5}
      onBack={onBack}
      onNext={onNext}
      nextLabel={t('next')}
      canNext={true}
      backLabel={t('back')}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2,1fr)',
          gap: 10,
          marginBottom: 16,
        }}
      >
        {elements.map((e) => {
          const isSel = selectedElements.includes(e.id);
          const isCustom = e.id.startsWith('custom_');
          return (
            <div
              key={e.id}
              className={`card ${isSel ? 'sel' : ''}`}
              style={pulse && isCustom ? { borderColor: 'var(--accent)' } : undefined}
              onClick={() => onToggle(e.id)}
            >
              <div className="card-checkb">{isSel && <CheckIcon />}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <WizardIcon name={e.icon} size={16} />
                <span>{e.label || t('elem_' + e.id)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 32 }}>
        <CustomOptionInput
          placeholder={t('customElementPlaceholder')}
          addLabel={t('addCustom')}
          onAdd={handleAdd}
        />
      </div>
    </PageWrap>
  );
}
