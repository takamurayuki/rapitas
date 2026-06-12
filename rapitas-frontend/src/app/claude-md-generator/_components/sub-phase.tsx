'use client';
// sub-phase

import React, { useState } from 'react';
import type { DynamicItem } from '../_types/types';
import { SUB_GENRES } from '../_utils/constants';
import { PageWrap } from './page-wrap';
import { CheckIcon } from './icons';
import { CustomOptionInput } from './custom-option-input';
import { WizardIcon } from './wizard-icons';

interface SubPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** Currently selected genre id / 選択済みジャンルID */
  genre: string;
  /** Currently selected sub-genre ids / 選択済みサブジャンルID一覧 */
  selectedSubs: string[];
  /** Sub-genre options (static catalog + user-added custom items) / サブジャンル選択肢（静的＋自由入力） */
  dynamicSubs: DynamicItem[];
  /** Toggles a sub-genre selection by id / IDでサブジャンル選択を切り替える */
  onToggle: (id: string) => void;
  /** Adds a user-typed custom sub-genre / 自由入力のサブジャンルを追加 */
  onAddCustom: (label: string) => void;
  /** Advances to elements phase; receives the resolved sub items for element suggestions / 要素フェーズへ進む */
  onNext: (selectedSubIds: string[]) => void;
  /** Returns to genre phase / ジャンルフェーズへ戻る */
  onBack: () => void;
}

/**
 * Sub-genre multi-select grid with a free-input field for custom entries,
 * wrapped in the shared PageWrap layout. Options come from the local static
 * catalog — no per-selection AI call.
 *
 * @param props - SubPhaseProps / SubPhaseProps参照
 */
export function SubPhase({
  topRef,
  t,
  genre,
  selectedSubs,
  dynamicSubs,
  onToggle,
  onAddCustom,
  onNext,
  onBack,
}: SubPhaseProps) {
  const subs =
    dynamicSubs.length > 0
      ? dynamicSubs
      : (SUB_GENRES[genre] || []).map((s) => ({
          id: s.id,
          icon: s.icon,
          label: t(`sub_${genre}_${s.id}`),
        }));

  const [pulse, setPulse] = useState(false);
  const handleAdd = (label: string) => {
    onAddCustom(label);
    // Brief highlight cue so the newly added (and auto-selected) item is noticed.
    setPulse(true);
    setTimeout(() => setPulse(false), 400);
  };

  return (
    <PageWrap
      topRef={topRef}
      title={(t as (k: string, v?: Record<string, unknown>) => string)('subTitle', {
        genre: t('genre_' + genre),
      })}
      sub={t('subSub')}
      step={2}
      total={5}
      onBack={onBack}
      onNext={() => onNext(subs.filter((s) => selectedSubs.includes(s.id)).map((s) => s.id))}
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
        {subs.map((s) => {
          const isSel = selectedSubs.includes(s.id);
          const isCustom = s.id.startsWith('custom_');
          return (
            <div
              key={s.id}
              className={`card ${isSel ? 'sel' : ''}`}
              style={pulse && isCustom ? { borderColor: 'var(--accent)' } : undefined}
              onClick={() => onToggle(s.id)}
            >
              <div className="card-checkb">{isSel && <CheckIcon />}</div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <WizardIcon name={s.icon} size={16} />
                  <span>{s.label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 32 }}>
        <CustomOptionInput
          placeholder={t('customSubPlaceholder')}
          addLabel={t('addCustom')}
          onAdd={handleAdd}
        />
      </div>
    </PageWrap>
  );
}
